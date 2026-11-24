#!/usr/bin/env python3
"""Download the history tools/regime-backtest.js needs into tools/regime-data/
(not committed; see DATA_SOURCES.md for terms). Free, no key:
  FRED (St. Louis Fed): SAHMREALTIME, GS10, TB3MS, BAA, USREC.
  S&P 500 daily closes since 1950 (^GSPC, Yahoo Finance chart API).
Usage: python3 tools/fetch-regime-data.py"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import server  # noqa: E402  (reuses the app's downloaders)

OUT = os.path.join(HERE, "regime-data")
os.makedirs(OUT, exist_ok=True)
for sid in ["SAHMREALTIME", "GS10", "TB3MS", "BAA", "USREC"]:
    rows = server._fred_full(sid)
    json.dump(rows, open(os.path.join(OUT, sid + ".json"), "w"))
    print(sid, len(rows), rows[0][0], "->", rows[-1][0])
rows, _ = server.fetch_yahoo_history("^GSPC", "1950-01-03")
rows = [[d, round(c, 2)] for d, c in rows]
json.dump(rows, open(os.path.join(OUT, "SPX.json"), "w"))
print("SPX", len(rows), rows[0][0], "->", rows[-1][0])
