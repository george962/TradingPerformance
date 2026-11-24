# Data sources

Your transactions come from the Fidelity CSV files you upload. They stay on
your computer.

Everything below is fetched **at runtime, on your own machine, for your
personal use**. The repository doesn't include any third-party market data:
downloads are cached in your data folder (see the README), never in the
app folder. The only data files that ship with the app are the two at the
end of this page.

## Fetched while the app runs

| Source | What it's used for | Terms / status |
| --- | --- | --- |
| **Yahoo Finance chart API** (`query1/2.finance.yahoo.com/v8/finance/chart`) | Daily prices for your stocks; the S&P 500 total-return (`^SP500TR`) and price (`^GSPC`) indexes; the UK, Japan, Germany and Canada indexes for the outlook's world check | Unofficial and undocumented. **Best-effort: may break, for personal use.** Covered by Yahoo's terms of service. Not licensed for redistribution, so none of it is stored in this repo. |
| **Yahoo Finance search API and RSS** | Headlines for your holdings and the market | Unofficial. **Best-effort: may break, for personal use.** Headlines link to the publishers. |
| **Google News RSS** | More headlines | Unofficial. **Best-effort: may break, for personal use.** |
| **CNN Fear & Greed** (`production.dataviz.cnn.io`) | Market mood card on News & Market | Unofficial feed behind CNN's own page. **Best-effort: may break, for personal use.** |
| **FRED**, St. Louis Fed (`fred.stlouisfed.org`) | Economy data for the outlook: SAHMREALTIME, GS10, TB3MS, BAA, USREC, ICSA, INDPRO, PERMIT, USALOLITONOSTSAM, OECDLOLITONOSTSAM, WTISPLC, DTWEXBGS, USEPUINDXM, UMCSENT, VIXCLS, NFCI, CPIAUCSL, FEDFUNDS | Free, no key. Covered by the [FRED terms of use](https://fred.stlouisfed.org/legal/). Most series are public domain. Some are copyrighted by their original provider (for example Moody's for BAA, Cboe for VIXCLS, the University of Michigan for UMCSENT, the OECD for the leading indicators, and Baker, Bloom & Davis for USEPUINDXM). Those are downloaded for your own use only and are never redistributed. Check each series page on FRED for its notes. |
| **Robert Shiller's CAPE (PE10)**, via the [`datasets/s-and-p-500`](https://github.com/datasets/s-and-p-500) GitHub mirror | The valuation input for the outlook model | See that repository's license and Shiller's [data page](http://www.econ.yale.edu/~shiller/data.htm). Downloaded at runtime only. |
| **Google Fonts** (Inter, Playfair Display) | Page fonts | SIL Open Font License. Your browser loads them from Google. If they're blocked, the page falls back to system fonts. |

If a download fails, the app keeps working from the last copy it saved and
tells you what failed. On the Data page you'll find price errors, and News
& Market reports news, market and model errors.

## Shipped in the repository

| File | What it is | Terms |
| --- | --- | --- |
| `regime-table.json` | Summary statistics only (counts, averages, percentiles) of what the S&P 500 did after each kind of month since 1960, plus the walk-forward test scores. It contains no raw price or economic data points. | Built from `^GSPC` (Yahoo) and FRED series by `tools/regime-backtest.js`. Rebuild it yourself with `python3 tools/fetch-regime-data.py && node tools/regime-backtest.js`. |
| `sample/sample-data.json` | The **Try sample data** set. The account, tickers, trades and every price, including the "S&P 500" line, are made up by a seeded random walk. | MIT, like the code. Rebuild it with `node tools/make-sample.js`. |

The test fixtures in `tests/` (`synthetic.csv`, `synthetic-sheet.csv`) are
made up too.
