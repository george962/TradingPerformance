# Changelog

## Unreleased: first public version

Built from the private v1.14, prepared for open source.

**Privacy**
- No personal data ships with the app: the bundled portfolio seed and the
  sample S&P 500 file are gone, and the tests use made-up data only.
- Your data now lives in a per-user folder outside the app (`~/Library/Application Support/TradingPerformance`
  on macOS, `%APPDATA%\TradingPerformance` on Windows,
  `~/.local/share/TradingPerformance` on Linux; set `TP_DATA_DIR` to change
  it). A `data.json` left in the app folder by an older version is moved
  there on start. The file is readable by your user only.

**Security**
- The server hands out only an allowlist of app files. Before this, any
  file in the folder could be fetched, including `server.py`, `.git/` and
  `data.json`.
- API calls are checked for Host (blocks DNS rebinding), Origin and
  cross-site fetch metadata, and must send JSON. Other websites you visit
  can no longer read, save or clear your data through `127.0.0.1`.
- Request bodies are capped at 32 MB. Bad requests get readable JSON errors.

**Features**
- **Try sample data**: a made-up account with five years of trades, fully
  offline, nothing saved. Built by `tools/make-sample.js`.
- The Portfolio page follows the account picker and shows one account at a
  time. Accounts that exist only in a monthly-returns sheet appear in the
  picker after you import a sheet.
- `start.bat` for Windows, and `python3 server.py` works everywhere.
- Plain-English explanations of the terms on Overview, and a welcome screen
  that says which Fidelity export to use.
- Readable download errors ("no internet connection", "check the symbol"…).
  The last failure is shown on the Data page, and the app keeps working
  from the last saved prices.
- The unofficial feeds (Yahoo, Google News, CNN) are labelled best-effort.
- `tools/regime-backtest.js` and `tools/fetch-regime-data.py` rebuild
  `regime-table.json`. See [DATA_SOURCES.md](DATA_SOURCES.md).
