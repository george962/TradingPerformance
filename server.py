#!/usr/bin/env python3
"""Trading Performance vs S&P 500 — local server (Python stdlib only).

Serves the dashboard, persists uploaded data locally, and fetches fresh
prices from the Yahoo Finance chart API (free, no key) for both individual
symbols, the S&P 500 total-return index (^SP500TR) and the price index (^GSPC). No dependencies, no pip installs.
All computation runs in the browser; this server is thin: serve, persist,
fetch prices.

Usage: double-click Start.command, or run `python3 server.py` in this folder.
"""
import gzip
import html
import json
import mimetypes
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(HERE, "data.json")
DEFAULT_PORT = 8765
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
TIMEOUT = 15


def log(msg):
    print("[%s] %s" % (datetime.now().strftime("%H:%M:%S"), msg), flush=True)


def load_data():
    if not os.path.exists(DATA_FILE):
        return {"transactions": [], "prices": {}, "files": [], "indexExtra": [],
                "lastRefresh": None}
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("transactions", [])
        data.setdefault("prices", {})
        data.setdefault("files", [])
        data.setdefault("indexExtra", [])
        data.setdefault("lastRefresh", None)
        return data
    except Exception as exc:
        log("WARNING: could not read data.json (%s); starting empty" % exc)
        return {"transactions": [], "prices": {}, "files": [], "indexExtra": [],
                "lastRefresh": None}


def save_data(data):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, DATA_FILE)


def _date_to_epoch(d):
    return int(datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())


def fetch_yahoo_history(symbol, start=None, range_="1mo"):
    """Daily closes for a symbol via the Yahoo Finance chart API (no key).

    v1.14: fetches from `start` (YYYY-MM-DD) to now when given, else
    `range_`. During market hours the last row is TODAY at the live price
    (regularMarketPrice) — refreshes show live values. Prices are un-adjusted
    for splits so they match the share counts in your Fidelity rows (Yahoo's
    closes are split-adjusted backward; a 10:1 split would otherwise make
    pre-split shares look 10x too valuable).

    Returns (rows, info): rows = [(date, close), ...] ascending;
    info = {"live": bool, "time": epoch or None}. Raises on failure."""
    last_exc = None
    if start:
        span = "period1=%d&period2=%d" % (_date_to_epoch(start) - 7 * 86400, int(time.time()) + 86400)
    else:
        span = "range=%s" % range_
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        url = ("https://%s/v8/finance/chart/%s?%s&interval=1d&events=split"
               % (host, urllib.parse.quote(symbol), span))
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = json.loads(resp.read().decode("utf-8", "replace"))
            result = (data.get("chart") or {}).get("result") or []
            if not result:
                raise ValueError("no chart result")
            r0 = result[0]
            meta = r0.get("meta") or {}
            timestamps = r0.get("timestamp") or []
            quotes = (r0.get("indicators") or {}).get("quote") or [{}]
            closes = quotes[0].get("close") or []
            gmtoffset = meta.get("gmtoffset") or 0

            def day(ts):
                return datetime.fromtimestamp(ts + gmtoffset, tz=timezone.utc).strftime("%Y-%m-%d")

            byday = {}
            for i, c in enumerate(closes):
                if c is None or i >= len(timestamps):
                    continue
                byday[day(timestamps[i])] = float(c)
            # Undo split adjustment: bars before a split are multiplied back.
            splits = ((r0.get("events") or {}).get("splits") or {}).values()
            for sp in splits:
                num, den = sp.get("numerator"), sp.get("denominator")
                if not num or not den or not sp.get("date"):
                    continue
                sday = day(sp["date"])
                ratio = float(num) / float(den)
                for d in list(byday):
                    if d < sday:
                        byday[d] = byday[d] * ratio
            info = {"live": False, "time": meta.get("regularMarketTime")}
            reg = ((meta.get("currentTradingPeriod") or {}).get("regular") or {})
            now = time.time()
            price, t = meta.get("regularMarketPrice"), meta.get("regularMarketTime")
            if reg.get("start") and reg.get("end") and reg["start"] <= now < reg["end"] and price:
                # Market is open: today's row is the live price.
                info["live"] = True
                byday[day(reg["start"])] = float(price)
            elif price and t and day(t) not in byday:
                byday[day(t)] = float(price)
            rows = sorted(byday.items())
            if not rows:
                raise ValueError("no closes found")
            return rows, info
        except Exception as exc:
            last_exc = exc
            continue
    raise last_exc


def refresh_prices(symbols, since=None):
    """v1.14 refresh. Fetches, for the whole period (from `since`):
      - daily history for EVERY symbol ever held (needed to value the
        account on each day for the time-weighted return),
      - the S&P 500 total-return index (^SP500TR, dividends reinvested) —
        the benchmark,
      - the S&P 500 price index (^GSPC) — extends the total-return series
        when it lags (it may not update intraday).
    During market hours every series ends with today's live price.
    Never fails the whole refresh for one bad symbol.
    Returns {prices, history, indexHistory, trHistory, live, asOf, errors}."""
    prices, history, errors = {}, {}, {}
    index_history, tr_history = [], []
    live, as_of = False, None
    try:
        rows, info = fetch_yahoo_history("^GSPC", since, "3mo")
        index_history = [[d, c] for d, c in rows]
        live = info["live"]
        as_of = info["time"]
        prices["^SPX"] = {"price": rows[-1][1], "date": rows[-1][0]}
    except Exception as exc:
        errors["^SPX"] = str(exc)
    try:
        rows, _ = fetch_yahoo_history("^SP500TR", since, "3mo")
        tr_history = [[d, c] for d, c in rows]
    except Exception as exc:
        errors["^SP500TR"] = str(exc)
    for sym in symbols:
        upper = sym.upper()
        if upper in ("^SPX", "^GSPC", "SPX", "^SP500TR"):
            continue
        try:
            rows, info = fetch_yahoo_history(upper, since, "3mo")
            history[upper] = [[d, c] for d, c in rows]
            prices[upper] = {"price": rows[-1][1], "date": rows[-1][0], "live": info["live"]}
        except Exception as exc:
            errors[upper] = str(exc)
    return {"prices": prices, "history": history, "indexHistory": index_history,
            "trHistory": tr_history, "live": live, "asOf": as_of, "errors": errors}


# ---------------------------------------------------------------- news
# Headlines for your holdings and the market (free, no key): the Yahoo
# Finance search API, Yahoo's RSS feed and Google News RSS (unofficial,
# best-effort). Cached in memory for 30 minutes.
NEWS_DAYS = 14
NEWS_TTL = 1800
_NEWS_CACHE = {}


def http_get(url, headers=None, timeout=TIMEOUT):
    hdrs = {"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"}
    hdrs.update(headers or {})
    req = urllib.request.Request(url, headers=hdrs)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
    return body


def _strip_html(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _parse_rss(xml_bytes, default_source):
    out = []
    root = ET.fromstring(xml_bytes)
    for item in root.iter("item"):
        title = _strip_html(item.findtext("title"))
        link = (item.findtext("link") or "").strip()
        pub = item.findtext("pubDate")
        src_el = item.find("source")
        source = src_el.text if src_el is not None and src_el.text else default_source
        if source and title.endswith(" - " + source):  # Google News titles end in " - Publisher"
            title = title[: -len(" - " + source)]
        try:
            published = parsedate_to_datetime(pub).astimezone(timezone.utc).isoformat() if pub else None
        except Exception:
            published = None
        desc = "" if default_source == "Google News" else _strip_html(item.findtext("description"))
        out.append({"title": title, "link": link, "source": source, "published": published, "summary": desc[:400]})
    return out


def _dedupe_recent(items, days, limit):
    cutoff = time.time() - days * 86400
    seen, out = set(), []
    for it in items:
        key = re.sub(r"[^a-z0-9]", "", (it.get("title") or "").lower())[:80]
        if not key or key in seen:
            continue
        try:
            ts = datetime.fromisoformat(it["published"]).timestamp() if it.get("published") else None
        except Exception:
            ts = None
        if ts is not None and ts < cutoff:
            continue
        seen.add(key)
        out.append(it)
    out.sort(key=lambda x: x.get("published") or "", reverse=True)
    return out[:limit]


def fetch_symbol_news(symbol):
    """Recent headlines for one symbol, plus its company name."""
    hit = _NEWS_CACHE.get(symbol)
    if hit and time.time() - hit["t"] < NEWS_TTL:
        return hit["v"]
    items, errors, name = [], [], ""
    q_sym = urllib.parse.quote(symbol)
    try:
        url = ("https://query1.finance.yahoo.com/v1/finance/search?q=%s&newsCount=20&quotesCount=1" % q_sym)
        data = json.loads(http_get(url).decode("utf-8", "replace"))
        for q in data.get("quotes") or []:
            if (q.get("symbol") or "").upper() == symbol:
                name = q.get("longname") or q.get("shortname") or ""
        for n in data.get("news") or []:
            t = n.get("providerPublishTime")
            items.append({"title": n.get("title") or "", "link": n.get("link") or "",
                          "source": n.get("publisher") or "Yahoo Finance",
                          "published": datetime.fromtimestamp(t, tz=timezone.utc).isoformat() if t else None,
                          "summary": ""})
    except Exception as exc:
        errors.append("Yahoo search: %s" % exc)
    try:
        url = "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%s&region=US&lang=en-US" % q_sym
        items += _parse_rss(http_get(url), "Yahoo Finance")
    except Exception as exc:
        errors.append("Yahoo RSS: %s" % exc)
    try:
        short = re.sub(r"[,.]|\b(Inc|Corp|Corporation|Co|Ltd|plc|Holdings|Company|Class [A-Z]|Trust|Fund)\b", "", name).strip()
        q = "%s stock when:%dd" % (('"%s" OR %s' % (short, symbol)) if short and short.upper() != symbol else symbol, NEWS_DAYS)
        url = "https://news.google.com/rss/search?q=%s&hl=en-US&gl=US&ceid=US:en" % urllib.parse.quote(q)
        items += _parse_rss(http_get(url), "Google News")
    except Exception as exc:
        errors.append("Google News: %s" % exc)
    v = {"symbol": symbol, "name": name, "items": _dedupe_recent(items, NEWS_DAYS, 60), "errors": errors}
    if v["items"]:
        _NEWS_CACHE[symbol] = {"t": time.time(), "v": v}
    return v


def fetch_market_news():
    hit = _NEWS_CACHE.get("^MARKET")
    if hit and time.time() - hit["t"] < NEWS_TTL:
        return hit["v"]
    items, errors = [], []
    for q in ['"stock market" when:7d', '"S&P 500" stocks when:7d', 'Wall Street stocks economy when:7d']:
        try:
            url = "https://news.google.com/rss/search?q=%s&hl=en-US&gl=US&ceid=US:en" % urllib.parse.quote(q)
            items += _parse_rss(http_get(url), "Google News")
        except Exception as exc:
            errors.append("Google News: %s" % exc)
    v = {"items": _dedupe_recent(items, 7, 60), "errors": errors}
    if v["items"]:
        _NEWS_CACHE["^MARKET"] = {"t": time.time(), "v": v}
    return v


def fetch_news(symbols):
    """Holdings + market news, fetched in parallel."""
    symbols = [s.upper() for s in symbols if s][:25]
    with ThreadPoolExecutor(max_workers=6) as pool:
        market = pool.submit(fetch_market_news)
        per = list(pool.map(fetch_symbol_news, symbols))
    return {"fetchedAt": datetime.now(timezone.utc).isoformat(), "market": market.result(),
            "symbols": {p["symbol"]: p for p in per}}


# ---------------------------------------------------------------- market
# Economy data for the outlook (FRED, free, no key) and CNN Fear & Greed
# (unofficial feed, best-effort).
MACRO_SERIES = ["SAHMREALTIME", "GS10", "TB3MS", "BAA"]
FG_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata/"
FG_HEADERS = {"User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                             "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
              "Accept": "application/json, text/plain, */*",
              "Origin": "https://www.cnn.com", "Referer": "https://www.cnn.com/"}
_MARKET_CACHE = {}


def fetch_macro():
    """Sahm rule, 10-yr and 3-month Treasury yields, Baa corporate yield
    (monthly, last 3 years). Cached 12 hours."""
    hit = _MARKET_CACHE.get("macro")
    if hit and time.time() - hit["t"] < 12 * 3600:
        return hit["v"]
    start = "%d-01-01" % (datetime.now().year - 3)
    out = {}
    for sid in MACRO_SERIES:
        raw = http_get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s&cosd=%s" % (sid, start),
                       headers={"User-Agent": "TradingPerformance-local/1.14"}).decode("utf-8", "replace")
        rows = []
        for line in raw.strip().splitlines()[1:]:
            parts = line.split(",")
            if len(parts) == 2 and parts[1] not in (".", ""):
                try:
                    rows.append([parts[0], float(parts[1])])
                except ValueError:
                    pass
        out[sid] = rows
    _MARKET_CACHE["macro"] = {"t": time.time(), "v": out}
    return out


def fetch_fear_greed():
    """CNN Fear & Greed: today's value and the last year. Cached 1 hour.
    (An unofficial CNN feed — it can change without notice.)"""
    hit = _MARKET_CACHE.get("fg")
    if hit and time.time() - hit["t"] < 3600:
        return hit["v"]
    start = datetime.fromtimestamp(time.time() - 370 * 86400, tz=timezone.utc).strftime("%Y-%m-%d")
    data = json.loads(http_get(FG_URL + start, headers=FG_HEADERS).decode("utf-8"))
    fg = data.get("fear_and_greed") or {}
    hist = [[datetime.fromtimestamp(p["x"] / 1000, tz=timezone.utc).strftime("%Y-%m-%d"), round(p["y"], 1)]
            for p in (data.get("fear_and_greed_historical") or {}).get("data") or []]
    v = {"score": round(fg["score"], 1) if fg.get("score") is not None else None, "rating": fg.get("rating"),
         "previousWeek": fg.get("previous_1_week"), "previousMonth": fg.get("previous_1_month"),
         "history": hist}
    _MARKET_CACHE["fg"] = {"t": time.time(), "v": v}
    return v


def fetch_market_data():
    out, errors = {"fetchedAt": datetime.now(timezone.utc).isoformat()}, {}
    try:
        out["macro"] = fetch_macro()
    except Exception as exc:
        errors["macro"] = str(exc)
    try:
        out["fearGreed"] = fetch_fear_greed()
    except Exception as exc:
        errors["fearGreed"] = str(exc)
    out["errors"] = errors
    return out


# ---------------------------------------------------------------- outlook model data
# Long histories for the outlook model: FRED (free, no key), the S&P 500
# and four other countries' indexes since their start (Yahoo), and the
# Shiller CAPE (Robert Shiller's data via the datasets/s-and-p-500 GitHub
# mirror). Cached in outlook-data/ for a day.
OUTLOOK_DIR = os.path.join(HERE, "outlook-data")
OUTLOOK_FRED = ["SAHMREALTIME", "GS10", "TB3MS", "BAA", "USREC", "ICSA", "INDPRO", "PERMIT", "USALOLITONOSTSAM",
                "OECDLOLITONOSTSAM", "WTISPLC", "DTWEXBGS", "USEPUINDXM", "UMCSENT", "VIXCLS", "NFCI", "CPIAUCSL", "FEDFUNDS"]
OUTLOOK_MARKETS = {"UK (FTSE 100)": "^FTSE", "Japan (Nikkei 225)": "^N225", "Germany (DAX)": "^GDAXI", "Canada (TSX)": "^GSPTSE"}
SHILLER_URL = "https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv"


def _cached(name, fetch, ttl=86400):
    os.makedirs(OUTLOOK_DIR, exist_ok=True)
    path = os.path.join(OUTLOOK_DIR, re.sub(r"[^A-Za-z0-9_-]", "_", name) + ".json")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < ttl:
        with open(path) as f:
            return json.load(f)
    try:
        rows = fetch()
    except Exception:
        if os.path.exists(path):  # keep the last good copy if the download fails
            with open(path) as f:
                return json.load(f)
        raise
    with open(path, "w") as f:
        json.dump(rows, f)
    return rows


def _fred_full(sid):
    raw = http_get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s" % sid,
                   headers={"User-Agent": "TradingPerformance-local/1.14"}).decode("utf-8", "replace")
    rows = []
    for line in raw.strip().splitlines()[1:]:
        parts = line.split(",")
        if len(parts) == 2 and parts[1] not in (".", ""):
            try:
                rows.append([parts[0], float(parts[1])])
            except ValueError:
                pass
    if not rows:
        raise ValueError("no data")
    return rows


def _shiller_pe10():
    raw = http_get(SHILLER_URL).decode("utf-8", "replace").splitlines()
    head = raw[0].split(",")
    i_d, i_pe = head.index("Date"), head.index("PE10")
    rows = []
    for line in raw[1:]:
        p = line.split(",")
        try:
            v = float(p[i_pe])
        except (ValueError, IndexError):
            continue
        if v > 0:
            rows.append([p[i_d], v])
    return rows


def fetch_outlook_data():
    out, errors = {}, {}
    jobs = [("SPX", lambda: [[d, c] for d, c in fetch_yahoo_history("^GSPC", "1950-01-03")[0]]),
            ("PE10", _shiller_pe10)] + [(sid, (lambda s: lambda: _fred_full(s))(sid)) for sid in OUTLOOK_FRED]
    markets = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = {pool.submit(_cached, name, fn): name for name, fn in jobs}
        mfuts = {pool.submit(_cached, "MKT_" + sym, (lambda s: lambda: [[d, c] for d, c in fetch_yahoo_history(s, "1950-01-03")[0]])(sym)): label
                 for label, sym in OUTLOOK_MARKETS.items()}
        for f, name in futs.items():
            try:
                out[name] = f.result()
            except Exception as exc:
                errors[name] = str(exc)[:120]
        for f, label in mfuts.items():
            try:
                markets[label] = f.result()
            except Exception as exc:
                errors[label] = str(exc)[:120]
    return {"series": out, "markets": markets, "errors": errors, "fetchedAt": datetime.now(timezone.utc).isoformat()}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass  # keep stdout clean; we log what matters ourselves

    # -- helpers ---------------------------------------------------------
    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    # -- routing ---------------------------------------------------------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/status":
            data = load_data()
            price_dates = [p.get("date") for p in data["prices"].values() if p.get("date")]
            self._send_json({
                "hasData": len(data["transactions"]) > 0,
                "fileCount": len(data["files"]),
                "files": data["files"],
                "transactionCount": len(data["transactions"]),
                "lastRefresh": data["lastRefresh"],
                "priceDate": max(price_dates) if price_dates else None,
            })
            return
        if path == "/api/load-data":
            self._send_json(load_data())
            return
        self._serve_static(path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/save-data":
            body = self._read_json()
            # v1.14: keep every field the app saves (price history, the
            # total-return series, live status, the portfolio sheet). v1.13
            # and earlier kept only the first five, so the downloaded history
            # was dropped on every reload.
            keys = ("transactions", "prices", "files", "indexExtra", "lastRefresh",
                    "history", "trHistory", "live", "liveAsOf", "liveDate",
                    "portfolio", "fileMeta", "accounts", "news", "market", "newsHistory", "outlookModel")
            data = {k: body.get(k) for k in keys if k in body}
            save_data(data)
            log("saved data.json (%d transactions, %d files)"
                % (len(data.get("transactions") or []), len(data.get("files") or [])))
            self._send_json({"ok": True})
            return
        if path == "/api/clear-data":
            if os.path.exists(DATA_FILE):
                os.remove(DATA_FILE)
            log("cleared data.json")
            self._send_json({"ok": True})
            return
        if path == "/api/outlook-data":
            log("downloading outlook model history (FRED, Yahoo, Shiller)")
            res = fetch_outlook_data()
            log("outlook data: %d series, %d markets, %d errors" % (len(res["series"]), len(res["markets"]), len(res["errors"])))
            self._send_json(res)
            return
        if path == "/api/market":
            log("fetching economy data + Fear & Greed")
            self._send_json(fetch_market_data())
            return
        if path == "/api/news":
            body = self._read_json()
            symbols = body.get("symbols") or []
            log("fetching news for: %s + market" % ", ".join(symbols))
            result = fetch_news(symbols)
            n = sum(len(v["items"]) for v in result["symbols"].values()) + len(result["market"]["items"])
            log("news done: %d headlines" % n)
            self._send_json(result)
            return
        if path == "/api/refresh-prices":
            body = self._read_json()
            symbols = body.get("symbols") or []
            since = body.get("since") or None
            log("refreshing prices for: %s (from %s)" % (", ".join(symbols), since or "recent"))
            result = refresh_prices(symbols, since)
            ok = [s for s in result["prices"] if s != "^SPX"]
            log("refresh done: %d prices ok, %d errors"
                % (len(ok), len(result["errors"])))
            self._send_json(result)
            return
        self._send_json({"error": "unknown endpoint"}, status=404)

    def _serve_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        # Prevent path traversal: stay inside HERE.
        rel = urllib.parse.unquote(path.lstrip("/"))
        full = os.path.normpath(os.path.join(HERE, rel))
        if not full.startswith(HERE):
            self.send_error(403)
            return
        if not os.path.isfile(full):
            self.send_error(404)
            return
        ctype, _ = mimetypes.guess_type(full)
        try:
            with open(full, "rb") as f:
                body = f.read()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        # Never cache the app files: after a folder update the browser must
        # load the new code on a plain reload, not a stale cached copy.
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.end_headers()
        self.wfile.write(body)


def main():
    port = DEFAULT_PORT
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError:
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        port = server.server_address[1]
    url = "http://127.0.0.1:%d/" % port
    log("Trading Performance vs S&P 500")
    log("Serving %s" % url)
    log("Data file: %s" % DATA_FILE)
    log("Press Ctrl-C to stop.")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("Stopped.")
        sys.exit(0)


if __name__ == "__main__":
    main()
