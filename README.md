# Trading Performance vs. the S&P 500

A small dashboard that runs on your own computer and answers one question:
**did my trading beat simply buying the S&P 500?**

Give it your Fidelity history exports (CSV). It rebuilds your account day by
day and compares it with the same money in the S&P 500 total-return index,
for the whole account, each year's purchases and every single buy.

- **Local only.** A small Python server on `127.0.0.1` serves the page and
  saves your data on your machine. Your transactions are never uploaded.
- **No installs.** Python 3 standard library plus vanilla JavaScript. No
  accounts, no API keys.
- **Network use:** only to fetch prices, economy data and headlines (see
  [Data sources](#data-sources)).

> Not investment advice. This is a personal tool for looking back at past
> trades. It may contain mistakes. Check important numbers against your
> broker's statements.

<!-- Screenshots: add once sample data ships (docs/screenshots/*.png). -->

## Quickstart

1. Get the code: `git clone` this repo, or download the ZIP and unzip it.
2. Start the server:
   - **macOS:** double-click `Start.command`.
   - **Any OS:** open a terminal in this folder and run `python3 server.py`
     (on Windows the command may be `py server.py`).
3. Your browser opens `http://127.0.0.1:8765/`. If that port is busy, the
   terminal shows the address it picked instead.
4. Drop your Fidelity CSV files onto the page.

To stop it, close the terminal window or press Ctrl-C.

### Which Fidelity export to use

Fidelity.com → **Accounts → History** → pick a date range → **Download**
(CSV). The file must have the standard history columns (Run Date, Action,
Symbol, Quantity, Price, Amount). One file per year works well. Upload them
all at once or a few at a time; uploading the same rows again adds nothing.

Files are matched to accounts by the number in the file name
(`History_for_Account_<number>_<year>.csv`), so keep Fidelity's file names.

Other brokers aren't supported yet.

## What you get

| Page | What it shows |
| --- | --- |
| **Overview** | Headline: your time-weighted return vs. the S&P 500, account value, growth chart, a card per year. |
| **Years** | Each year's purchases followed to their sale, and where the proceeds went. |
| **Purchases** | Every buy as a card: beat / in line / lagged the index over its own dates. Filter, sort, or group by stock. |
| **Portfolio** | Monthly returns for the selected account vs. the S&P 500: stats, cumulative chart, monthly table. |
| **News & Market** | Headlines for your holdings with a tone score, CNN Fear & Greed, and an economy outlook built on historical odds. |
| **Data** | Upload files, rename accounts, check the rebuilt balance against Fidelity, privacy mode, start over. |

With more than one account, an **account picker** appears at the top right.
Overview, Years, Purchases and Portfolio all show the picked account.

**Privacy mode** (Data → Settings → Hide dollar amounts) replaces every
dollar amount and share count with `$•••`. Percentages and charts stay
visible, so you can take screenshots without showing balances.

### Optional: monthly-returns sheet

For accounts you don't have Fidelity files for (a workplace 401k, say), you
can drop in a CSV of monthly returns. Those accounts then show up in the
picker on the Portfolio page. The format is in
[docs/METHODS.md](docs/METHODS.md#monthly-returns-sheet-format).

## Terms used

- **Money in:** money you added from outside (contributions, rollovers,
  transfers, Roth conversions). Dividends and interest are *returns*, not
  money in.
- **Time-weighted return (TWR):** your return with the timing and size of
  deposits taken out, so a big deposit doesn't count as a gain. It's the
  usual way to compare an account with an index.
- **pp (percentage points):** the gap between two percentages. You +12%,
  S&P +10% means +2 pp.
- **Buy-and-hold:** the same deposits, each put into the S&P 500
  total-return index on the day it arrived.
- **Beat / in line / lagged:** more than 0.5 pp ahead, within ±0.5 pp, or
  more than 0.5 pp behind the index over the same dates.

The full method is in [docs/METHODS.md](docs/METHODS.md).

## Where your data is kept

Uploaded data is saved to `data.json` in this folder, which `.gitignore`
keeps out of git. Delete it, or use **Data → Start over**, to wipe
everything. Your original CSV files are never changed.

## Data sources

Prices come from Yahoo Finance, headlines from Yahoo Finance and Google News
RSS, and market mood from CNN's Fear & Greed feed. All of these are
unofficial and **best-effort: they may break and are for personal use**.
Economy data comes from FRED (St. Louis Fed). If a price fetch fails, the
app keeps the last prices it fetched successfully.

## FAQ / troubleshooting

**"Could not start the dashboard."** The server isn't running. Start it
again and reload the page.

**Double-clicking `Start.command` does nothing (macOS).** It may have lost
its executable bit. Run `chmod +x Start.command` in this folder. If macOS
blocks it as "from an unidentified developer," right-click → Open.

**Python not found.** Install Python 3 from python.org. On macOS you can
also run `xcode-select --install`.

**Prices didn't update.** You need internet access. Symbols that fail keep
their last known price, and the status line names them.

**"Rebuilt cash differs from Fidelity's Cash Balance" or "Sold more shares
than the uploaded files show".** A file or a year is probably missing.
Upload it to close the gap.

**Why doesn't this match Fidelity's own return figure?** Fidelity may use a
different method (money-weighted, or a different benchmark). This app uses
a time-weighted return against the S&P 500 *total-return* index, with
dividends reinvested.

## Development

```sh
node tests/test-engine.js
node tests/test-render.js
node tests/test-news.js
node tests/test-economy.js
node tests/test-outlook-model.js
python3 tests/test_server.py
```

No dependencies. Tests use made-up data in `tests/synthetic*.csv`.

## Roadmap

- "All accounts combined" view (needs cash flows between accounts handled)
- Brokers other than Fidelity
- Built-in sample data for trying the app without your own files

## License

MIT. See [LICENSE](LICENSE).
