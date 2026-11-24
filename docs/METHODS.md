# How it's calculated

All returns are pre-tax and return-only. They are not risk-adjusted.

## Rebuilding the account

- The account is rebuilt **day by day** from the Fidelity rows: shares per
  stock (fractional shares included), plus cash from the Amount column.
  SPAXX and similar money-market positions count as cash, as Fidelity
  shows them.
- Each day's value = shares × that day's closing price + cash.
- Rebuilt cash is checked every day against Fidelity's **Cash Balance**
  column. The Data page shows how many days matched.
- **Stock splits:** Yahoo's split-adjusted history is converted back to the
  prices you actually traded at, so it lines up with the share counts in
  your files.

## Money in

Money in is **outside money only**: contributions, rollovers, transfers in
and out, and Roth conversions (share conversions count at their stated
value). **Dividends and interest are part of your return.** They never count
as money in.

## Headline: time-weighted return

- Daily return = today's value ÷ (yesterday's value + money that arrived
  today) − 1. The daily returns are multiplied together.
- Because of this, deposits and rollovers can't inflate or shrink the
  return.
- The benchmark is the **S&P 500 total-return index** (`^SP500TR`,
  dividends reinvested) over the same dates. If that series can't be
  fetched, the app uses the price index (`^GSPC`) and says so.
- Headline (pp) = your time-weighted return − the index return.

## Dollars

- **Your gain** = account value − money in.
- **Buy-and-hold** = the same deposits, each bought into the total-return
  index on the day it arrived.

## Years

A year view judges **the purchases made that year**. Each one is followed
from its buy date to the day it was sold (or today, if still held),
dividends included, and compared with the same dollars in the total-return
index over exactly the same dates. Year-end is not a stopping point.

"Follow the money" shows those buys, their sales, and which later buys the
proceeds paid for. Sale proceeds travel as one pot: a purchase that spends
part of the pot takes the same fraction of every year's money in it.

**Years → All** shows the same time-weighted headline as Overview. Next to
it is the buy-by-buy figure (each purchase vs. the index over its own
dates, weighted by dollars). That figure is usually lower when most of the
dollars were invested recently.

Which year gets credit for a reinvested dollar is an allocation choice.
Single-year splits can therefore differ between tools by small amounts even
when the all-years total is the same. Trust "All".

## Purchases

- Lots are matched **FIFO** (oldest shares sold first), with fractional
  shares.
- Same-day whole and fractional rows (e.g. 31 + 0.043 shares) are one
  purchase.
- Dividends are credited to the shares that earned them. Reinvested
  dividends add shares to that same purchase, so an S&P 500 fund lands at
  about 0 pp.
- When one sale spans several purchases, proceeds are split by matched cost
  (shares × buy price).
- **New** vs **reinvested** = paid for with deposits vs. with earlier sale
  proceeds and dividends.
- A purchase the recorded cash misses by $1 or less is treated as rounding.
- Transactions are processed in a fixed order (date; money in, then sales,
  then purchases; then symbol, action, price, quantity, amount), so the same
  files always give the same numbers, whatever order you upload them in.

**Beat / in line / lagged:** more than 0.5 pp ahead of the index (green),
more than 0.5 pp behind (red), otherwise in line (yellow).

## Portfolio page

The Portfolio page shows **the account selected in the account picker**.

- **Accounts from your Fidelity files** are calculated: daily time-weighted
  returns chained into months, vs. the S&P 500 total return over the same
  days. The latest month runs to the latest close.
- **Accounts from an imported sheet** use the monthly returns exactly as
  entered, vs. the sheet's own S&P 500 column. They appear in the picker
  only after you import a sheet.
- When a Fidelity account has the same type as a sheet column, the
  calculated account is shown and the sheet column is only used as a
  cross-check.

For every account, both lines start at 1.0 and compound the same months.
The stats are total return, per year (annualized), win rate, the worst
drawdown (from a peak to the low after it) and the best run (from a low to
the high after it).

### Monthly-returns sheet format

A CSV (for example a Google Sheets tab saved with File → Download → CSV).
Near the top is a header row naming the columns: `S&P 500`, `Roth IRA`,
`Investment` and/or `Roth 401k`. Under each name is a pair of columns:
month, then return.

```csv
S&P 500,,Roth IRA,,Investment,,Roth 401k,
Jan 2025,1.20%,Jan 2025,2.00%,Jul 2025,0.30%,Sep 2025,-1.00%
Feb 2025,-2.10%,Feb 2025,-3.00%,Aug 2025,0.10%,Oct 2025,2.00%
```

- Months can be `Mar 2025`, `March 2025`, `3/2025` or `2025-03`.
- Returns can be `4.84%`, `-5.09%` or `(1.2%)`.
- The file is recognized automatically when you drop it in. A new import
  replaces the previous sheet.
- Account types: Roth IRA → Roth IRA, Investment → Brokerage, Roth 401k →
  Roth 401k. Set your Fidelity accounts' types on the Data page so they
  line up.

## News tone

Each headline is matched against weighted positive and negative phrases
("beats estimates", "raises guidance", "upgrade" vs. "misses", "lawsuit",
"downgrade"). Tone = (positive − negative) ÷ max(2, positive + negative),
from −1 to +1. A stock's tone averages its headlines from the last 14 days,
with newer ones counting more (7-day half-life) and passing mentions
counting less. **Your holdings' news** weights each stock by its share of
your holdings. **Market mood** does the same for market headlines, grouped by
theme. This summarizes the news. It is not a forecast.

## Economy & market outlook

**Today's situation** = the S&P 500 vs. its 200-day average, plus three
recession warning lights:

- the Sahm rule ≥ 0.50;
- the 10-year minus 3-month Treasury yield inverted at any point in the
  past year;
- Baa corporate spreads up ≥ 0.50 points in 6 months.

Economy data (FRED) is used only once it would have been published, about
5 weeks after each month.

**What the S&P did next** in past months like today, compared with all
months: the chance it was higher, the chance of another 10% drop, and
bad / typical / good results over 1, 3, 6 and 12 months. The odds come from
`regime-table.json`, a backtest of S&P 500 months since 1960. Tested month
by month since 1975 using only earlier data, these odds warned of further
10% drops better than the long-run average and were only slightly better
at calling up or down. They are odds from history, not a forecast.

### The tested model ("Does more data help?")

This checks whether **more** inputs make better predictions. An input is
kept only if it helps on years the model never saw.

- **Inputs (11 groups):** market trend, valuation (Shiller CAPE), yield
  curve, credit spreads, jobs (Sahm rule, jobless claims), economic
  activity (industrial production, permits, OECD US leading indicator),
  global economy (OECD-wide leading indicator, oil, US dollar), policy
  uncertainty (Economic Policy Uncertainty index), sentiment (Michigan
  consumer sentiment, VIX), financial conditions (Chicago Fed NFCI),
  inflation & the Fed.
- **Questions:** S&P higher in 3 months; higher in 12 months; a further 10%
  drop within 3 months; a US recession within 12 months.
- **Data:** about 70 years, downloaded on first use from FRED, Yahoo
  Finance (S&P 500 plus UK, Japan, Germany and Canada indexes) and Robert
  Shiller's CAPE data, then cached in `outlook-data/` for a day. Economic
  data is lagged 1–2 months to when it was actually published.
- **Testing:** logistic regression, refit every year on earlier months only.
  Inputs are chosen on 1975–1999 (added only if they improve the accuracy
  score by ≥ 1.5%), and 2000–today is held out as the test. If the model
  doesn't beat the long-run average on the test, the page shows the
  long-run average instead.
- **World check:** the same trend rules run on four other countries'
  indexes.
- The model is built in a background worker (`outlook-worker.js`,
  `outlook-model.js`). It rebuilds weekly when you open News & Market, or
  when you press Rebuild.

Some series start late (VIX 1990, policy uncertainty 1985, the broad dollar
index 2006). A group is tested only if at least half its values exist in
1975–1999. Missing months count as average.

**CNN Fear & Greed** is shown for mood only. In backtests it didn't improve
forecasts.
