/* Trading Performance vs S&P 500 — computation engine (v1.14).
 *
 * Pure JavaScript, no dependencies. Works in the browser and in Node.
 *
 * Method:
 *  - The account is rebuilt day by day from the Fidelity rows: shares per
 *    symbol (fractions included) and cash (Amount column; money-market
 *    funds count as cash, as in Fidelity). Daily value = shares x that
 *    day's price + cash. Rebuilt cash is checked against Fidelity's own
 *    Cash Balance column.
 *  - Money in = external flows only: contributions, rollovers, transfers,
 *    Roth conversions (share conversions at their stated value).
 *    Dividends and interest are RETURNS, never money in.
 *  - Headline pp = time-weighted return (daily returns chained, so deposits
 *    and rollovers do not distort it) minus the S&P 500 total-return index
 *    over the same dates.
 *  - Dollars = your gain (value - money in) vs the same deposits bought in
 *    the S&P 500 total-return index on the day each arrived.
 *  - Year views judge the purchases made that year, each from its buy date
 *    to its sale (or today if held), against the benchmark over the same
 *    dates (dollar-weighted). The all-years headline is time-weighted.
 *  - Purchase cards: FIFO lots with fractional shares, dividends credited
 *    to the lots that earned them, window-matched against the benchmark.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TradingEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Money-market symbols treated as cash, not positions.
  var MONEY_MARKET = { SPAXX: 1, FDRXX: 1, SPRXX: 1, FZFXX: 1, FCASH: 1 };

  // ---------------------------------------------------------------- CSV parsing

  // Minimal CSV parser: handles quoted fields, commas and newlines in quotes.
  function parseCSVText(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += c;
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  function parseNumber(s) {
    if (s === null || s === undefined) return 0;
    s = String(s).trim().replace(/[$,\s]/g, '');
    if (s === '' || s === '--' || s === '-') return 0;
    var neg = false;
    if (s.charAt(0) === '(' && s.charAt(s.length - 1) === ')') {
      neg = true; s = s.slice(1, -1);
    }
    var v = parseFloat(s);
    if (isNaN(v)) return 0;
    return neg ? -Math.abs(v) : v;
  }

  // Fidelity dates are MM/DD/YYYY. Returns YYYY-MM-DD, or '' if unparsable.
  function parseFidelityDate(s) {
    if (!s) return '';
    s = String(s).trim();
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return '';
  }

  // Parse one Fidelity "History" CSV export. Returns { rows, skipped }.
  // Each row: { date, action, symbol, quantity, price, amount, fees, filename }.
  function parseFidelityCSV(text, filename) {
    var grid = parseCSVText(text);
    var headerIdx = -1;
    var cols = null;
    for (var i = 0; i < grid.length; i++) {
      var lower = grid[i].map(function (c) { return String(c).trim().toLowerCase(); });
      if (lower.indexOf('run date') !== -1 && lower.indexOf('action') !== -1) {
        headerIdx = i; cols = lower; break;
      }
    }
    var rows = [];
    var skipped = 0;
    if (headerIdx === -1) return { rows: rows, skipped: 0, error: 'No Fidelity header row found (expected Run Date / Action columns).' };
    function col(name) { return cols.indexOf(name); }
    var cDate = col('run date'), cAction = col('action'), cSymbol = col('symbol'),
      cQty = col('quantity'), cPrice = col('price ($)'),
      cAmount = col('amount ($)'), cFees = col('fees ($)'), cComm = col('commission ($)'), cBal = col('cash balance ($)');
    for (var r = headerIdx + 1; r < grid.length; r++) {
      var g = grid[r];
      if (!g || g.length === 0) continue;
      var date = parseFidelityDate(g[cDate]);
      var action = cAction >= 0 ? String(g[cAction] || '').trim() : '';
      if (!date || !action) { skipped++; continue; }
      // Fidelity shows sale quantities as negative (e.g. -26). Normalize to
      // positive here: the action already says which way the shares move, and
      // a negative quantity would silently match zero shares in the engine.
      var qty = cQty >= 0 ? parseNumber(g[cQty]) : 0;
      if (action.toUpperCase().indexOf('SOLD') !== -1) qty = Math.abs(qty);
      rows.push({
        date: date,
        action: action,
        symbol: cSymbol >= 0 ? String(g[cSymbol] || '').trim().toUpperCase() : '',
        quantity: qty,
        price: cPrice >= 0 ? parseNumber(g[cPrice]) : 0,
        amount: cAmount >= 0 ? parseNumber(g[cAmount]) : 0,
        fees: (cFees >= 0 ? parseNumber(g[cFees]) : 0) + (cComm >= 0 ? parseNumber(g[cComm]) : 0),
        cashBalance: (cBal >= 0 && String(g[cBal] || '').trim() !== '') ? parseNumber(g[cBal]) : undefined,
        filename: filename || ''
      });
    }
    return { rows: rows, skipped: skipped };
  }

  // Content key for dedupe: the full normalized row (excluding filename).
  function contentKey(tx) {
    return [tx.date, tx.action, tx.symbol, tx.quantity, tx.price, tx.amount, tx.fees].join('|');
  }

  // Assign occurrence-suffixed keys within one upload batch, so two identical
  // rows in the same file both survive (e.g. two identical $2,000 FXAIX sales
  // on the same day). Returns the rows with .key set.
  function assignOccurrenceKeys(rows) {
    var counts = {};
    rows.forEach(function (tx) {
      var ck = contentKey(tx);
      counts[ck] = (counts[ck] || 0) + 1;
      tx.key = ck + '#' + counts[ck];
    });
    return rows;
  }

  // Merge incoming rows into the stored set by occurrence key. Re-uploading the
  // same file adds only rows not already stored. Returns { merged, added }.
  function mergeTransactions(existing, incoming) {
    var seen = {};
    existing.forEach(function (tx) { seen[tx.key] = tx; });
    var merged = existing.slice();
    var added = 0;
    incoming.forEach(function (tx) {
      if (!seen[tx.key]) { seen[tx.key] = tx; merged.push(tx); added++; }
      else if (seen[tx.key] !== 1 && seen[tx.key].cashBalance === undefined && tx.cashBalance !== undefined) {
        // v1.14: rows saved by older versions lack the Cash Balance column;
        // re-uploading the same file fills it in (used for the cash check).
        seen[tx.key].cashBalance = tx.cashBalance;
      }
    });
    return { merged: merged, added: added };
  }

  // ---------------------------------------------------------------- Index series

  // closes: [[date, close], ...] sorted ascending by date, valid closes only.
  function IndexSeries(closes) {
    this.dates = closes.map(function (c) { return c[0]; });
    this.closes = closes.map(function (c) { return c[1]; });
  }
  IndexSeries.prototype.lastDate = function () { return this.dates[this.dates.length - 1]; };
  IndexSeries.prototype.lastClose = function () { return this.closes[this.closes.length - 1]; };
  // Most recent valid close on or before the requested date (prior trading day
  // when the date is a non-trading day). Returns null if before the series start.
  IndexSeries.prototype.closeOnOrBefore = function (date) {
    var lo = 0, hi = this.dates.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (this.dates[mid] <= date) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans === -1 ? null : this.closes[ans];
  };
  IndexSeries.prototype.returnBetween = function (startDate, endDate) {
    var s = this.closeOnOrBefore(startDate);
    var e = this.closeOnOrBefore(endDate);
    if (s === null || e === null || s === 0) return 0;
    return e / s - 1;
  };

  // ---------------------------------------------------------------- Classification

  // Same-day processing order: money in, then sales, then purchases, so
  // same-day funding is available before it is spent.
  var ORDER = { flow: 0, income: 0, sale: 1, buy: 2, other: 3 };

  // Kinds:
  //   flow     — external money in/out (contribution, rollover, transfer,
  //              cash Roth conversion). Counts as money in.
  //   flowShares — a Roth conversion that brings SHARES in: money in at its
  //              stated value, shares added, cash unchanged.
  //   income   — dividends and money-market interest: cash in, a RETURN.
  //   buy / sale / reinvest — trades (cash <-> shares).
  //   split    — share distribution with no cash (stock split).
  //   mmcash   — money-market buy/sell/reinvest: cash stays cash, ignored.
  //   other    — unrecognized: its amount still moves cash (so the rebuilt
  //              balance keeps matching Fidelity), reported as a warning.
  function classify(tx) {
    var a = tx.action.toUpperCase();
    var sym = tx.symbol;
    var isMM = !!MONEY_MARKET[sym];
    if (a.indexOf('YOU BOUGHT') !== -1) return isMM ? 'mmcash' : 'buy';
    if (a.indexOf('YOU SOLD') !== -1) return isMM ? 'mmcash' : 'sale';
    if (a.indexOf('REINVESTMENT') !== -1) return isMM ? 'mmcash' : 'reinvest';
    if (a.indexOf('DIVIDEND') !== -1 || a.indexOf('INTEREST') !== -1 ||
        a.indexOf('CAP GAIN') !== -1) return 'income';
    if (a.indexOf('CONTRIBUTION') !== -1 || a.indexOf('ROLLOVER') !== -1 ||
        a.indexOf('TRANSFER') !== -1) return 'flow';
    if (a.indexOf('CONVER') !== -1) {
      return (sym && !isMM && tx.quantity > 0) ? 'flowShares' : 'flow';
    }
    if ((a.indexOf('SPLIT') !== -1 || a.indexOf('DISTRIBUTION') !== -1) &&
        sym && !isMM && tx.quantity > 0 && !(Math.abs(tx.amount) > 0)) return 'split';
    return 'other';
  }
  function orderOf(kind) {
    if (kind === 'flow' || kind === 'income') return ORDER.flow;
    if (kind === 'sale') return ORDER.sale;
    if (kind === 'buy' || kind === 'reinvest' || kind === 'flowShares' || kind === 'split') return ORDER.buy;
    return ORDER.other;
  }
  function flowType(tx) {
    var a = tx.action.toUpperCase();
    if (a.indexOf('CONTRIBUTION') !== -1) return 'contribution';
    if (a.indexOf('ROLLOVER') !== -1) return 'rollover';
    if (a.indexOf('CONVER') !== -1) return 'conversion';
    if (a.indexOf('TRANSFER') !== -1) return tx.amount < 0 ? 'withdrawal' : 'transfer';
    return 'flow';
  }

  function canonicalSort(items) {
    items.sort(function (a, b) {
      var x = a.tx, y = b.tx;
      if (x.date !== y.date) return x.date < y.date ? -1 : 1;
      if (a.order !== b.order) return a.order - b.order;
      if (x.symbol !== y.symbol) return x.symbol < y.symbol ? -1 : 1;
      if (x.action !== y.action) return x.action < y.action ? -1 : 1;
      if (x.price !== y.price) return x.price - y.price;
      var qx = Math.abs(x.quantity), qy = Math.abs(y.quantity);
      if (qx !== qy) return qx - qy;
      if (x.amount !== y.amount) return x.amount - y.amount;
      if (x.key !== y.key) return String(x.key) < String(y.key) ? -1 : 1;
      return 0;
    });
    return items;
  }

  // ---------------------------------------------------------------- Prices

  // Daily price lookup for every symbol: fetched history first (close on or
  // before the date), then the prices from your own trades in the CSVs (so
  // the account can still be valued before the first refresh).
  function PriceBook(history, transactions, currentPrices) {
    var self = this;
    this.series = {};
    this.fromTrades = {};
    this.current = currentPrices || {};
    Object.keys(history || {}).forEach(function (s) {
      var rows = (history[s] || []).filter(function (r) { return r && r[1] > 0; })
        .slice().sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
      if (rows.length) self.series[s] = new IndexSeries(rows);
    });
    var trades = {};
    transactions.forEach(function (tx) {
      if (!tx.symbol || MONEY_MARKET[tx.symbol]) return;
      var p = tx.price > 0 ? tx.price : (tx.quantity > 0 && Math.abs(tx.amount) > 0 ? Math.abs(tx.amount) / tx.quantity : 0);
      if (!(p > 0)) return;
      if (!trades[tx.symbol]) trades[tx.symbol] = {};
      trades[tx.symbol][tx.date] = p;
    });
    Object.keys(trades).forEach(function (s) {
      var rows = Object.keys(trades[s]).sort().map(function (d) { return [d, trades[s][d]]; });
      self.fromTrades[s] = new IndexSeries(rows);
    });
  }
  PriceBook.prototype.hasHistory = function (sym) { return !!this.series[sym]; };
  PriceBook.prototype.on = function (sym, date, isEnd) {
    if (isEnd) {
      var cp = this.current[sym];
      if (cp && cp.price > 0 && (!cp.date || cp.date <= date)) {
        // A refreshed price is used unless the history has a newer close.
        var hs = this.series[sym];
        if (!hs || !(hs.lastDate() > cp.date)) return cp.price;
      }
    }
    var s = this.series[sym];
    if (s) {
      var v = s.closeOnOrBefore(date);
      if (v !== null) return v;
    }
    var t = this.fromTrades[sym];
    if (t) {
      var w = t.closeOnOrBefore(date);
      if (w !== null) return w;
      return t.closes[0];
    }
    if (s) return s.closes[0];
    return 0;
  };

  // ---------------------------------------------------------------- Engine

  var EPS = 1e-6;
  function r6(x) { return Math.round(x * 1e6) / 1e6; }

  // transactions: parsed + deduped rows (with .key).
  // index: IndexSeries for the benchmark (S&P 500 total return when
  //   available; the price index otherwise — see options.indexIsTotalReturn).
  // currentPrices: { SYM: { price, date } } — latest refreshed prices.
  // options: { history: { SYM: [[date, close]...] }, indexIsTotalReturn }.
  function compute(transactions, index, currentPrices, options) {
    options = options || {};
    currentPrices = currentPrices || {};
    var endDate = index.lastDate();
    var endClose = index.lastClose();
    var warnings = [];
    var prices = new PriceBook(options.history || {}, transactions, currentPrices);
    function idx(date) {
      var v = index.closeOnOrBefore(date);
      return v === null ? index.closes[0] : v;
    }

    // ---- classify + order ----
    var items = [];
    var ignored = 0, cashRows = 0, afterEnd = 0;
    transactions.forEach(function (tx) {
      var kind = classify(tx);
      if (kind === 'mmcash') { cashRows++; return; }
      if (tx.date > endDate) { afterEnd++; return; }
      if (kind === 'other') ignored++;
      items.push({ kind: kind, order: orderOf(kind), tx: tx });
    });
    canonicalSort(items);
    if (afterEnd) warnings.push(afterEnd + ' transaction(s) are dated after the latest price (' + endDate + ') and are left out until prices are refreshed.');
    if (ignored) warnings.push(ignored + ' row(s) had an unrecognized action; their amounts still count toward cash.');

    // ---- state ----
    var cash = 0;
    var shares = {};          // symbol -> shares held (fractions included)
    var lotsBySymbol = {};    // symbol -> open lots, FIFO
    var purchases = [];       // visible lots (cards)
    var pool = [];            // FIFO cash tranches { amount, kind: 'new'|'reinvested' }
    var flows = [];           // { date, amount, type }
    var incomeRows = [];      // { date, amount, symbol }
    var salesLog = [];        // { date, symbol, shares, proceeds, gain }
    var buyRows = [];         // for gross purchases: every buy row
    var unmatched = {};

    // origin: for sale proceeds, the purchase year of the shares sold (so a
    // year view can follow its money into later buys); 'income' for
    // dividends/interest; 'deposit' for new money.
    function addPool(amount, kind, origin) {
      if (amount > EPS) pool.push({ amount: amount, kind: kind, origin: origin || (kind === 'new' ? 'deposit' : 'income') });
    }
    function drawPool(amount) {
      var out = { 'new': 0, reinvested: 0, from: {} };
      var rem = amount;
      while (rem > EPS && pool.length) {
        var t = pool[0];
        var take = Math.min(t.amount, rem);
        out[t.kind] += take;
        out.from[t.origin] = (out.from[t.origin] || 0) + take;
        t.amount -= take; rem -= take;
        if (t.amount <= EPS) pool.shift();
      }
      // A buy the cash pool cannot cover (e.g. a missing upload year) is
      // counted as new money — never silently dropped.
      if (rem > EPS) out['new'] += rem;
      return out;
    }
    function openLots(sym) {
      if (!lotsBySymbol[sym]) lotsBySymbol[sym] = [];
      return lotsBySymbol[sym];
    }
    function newLot(sym, date, qty, cost, funding, visible) {
      var lot = {
        symbol: sym, buyDate: date, shares: qty, buyPrice: qty > 0 ? cost / qty : 0,
        cost: cost, fundingNew: funding['new'], fundingReinvested: funding.reinvested,
        fundingFrom: Object.assign({}, funding.from || {}),
        soldPieces: [], remaining: qty, dividends: 0, visible: visible,
        // basis = original dollars still in the lot. Reinvested dividends
        // add shares to the lot at no extra basis (the dividend is already
        // in them), so the lot compounds like the total-return index.
        basis: cost, dripShares: 0, dividendsTotal: 0
      };
      openLots(sym).push(lot);
      if (visible) purchases.push(lot);
      return lot;
    }
    var lastDiv = {};
    // A reinvested dividend spends the dividend cash itself (the newest
    // income in the pool), not the oldest money.
    function takeIncome(amount) {
      var rem = amount;
      for (var k = pool.length - 1; k >= 0 && rem > EPS; k--) {
        if (pool[k].origin !== 'income') continue;
        var tk = Math.min(pool[k].amount, rem);
        pool[k].amount -= tk; rem -= tk;
        if (pool[k].amount <= EPS) pool.splice(k, 1);
      }
      if (rem > EPS) drawPool(rem);
    }
    // Same-day buys of one symbol are one purchase: Fidelity splits an order
    // into a whole-share row and a fractional row (e.g. 31 + 0.043 NVDA).
    var dayLot = {};

    // ---- day-by-day walk ----
    var dayMap = {};
    items.forEach(function (it) {
      var d = it.tx.date;
      if (!dayMap[d]) dayMap[d] = [];
      dayMap[d].push(it);
    });
    var txDates = Object.keys(dayMap).sort();
    if (!txDates.length) {
      return emptyResult(endDate, endClose, warnings);
    }
    var startDate = txDates[0];
    var dateSet = {};
    txDates.forEach(function (d) { dateSet[d] = 1; });
    index.dates.forEach(function (d) { if (d >= startDate && d <= endDate) dateSet[d] = 1; });
    var days = Object.keys(dateSet).sort();

    var cashChecks = { matched: 0, checked: 0, mismatches: [] };
    var series = [];          // { date, value, holdings, cash, flow, r }
    var prevValue = 0, shadowUnits = 0, cum = 1;
    days.forEach(function (d, di) {
      var flowToday = 0;
      dayLot = {};
      (dayMap[d] || []).forEach(function (it) {
        var tx = it.tx, kind = it.kind, amt = tx.amount, q = Math.abs(tx.quantity);
        if (kind === 'flow') {
          cash += amt; flowToday += amt;
          flows.push({ date: d, amount: amt, type: flowType(tx) });
          if (amt > 0) addPool(amt, 'new'); else drawPool(-amt);
        } else if (kind === 'flowShares') {
          var val = Math.abs(amt) > 0 ? Math.abs(amt) : q * tx.price;
          flowToday += val;
          flows.push({ date: d, amount: val, type: 'conversion' });
          shares[tx.symbol] = (shares[tx.symbol] || 0) + q;
          newLot(tx.symbol, d, q, val, { 'new': val, reinvested: 0 }, true);
        } else if (kind === 'income') {
          cash += amt;
          incomeRows.push({ date: d, amount: amt, symbol: tx.symbol });
          addPool(amt, 'reinvested');
          // Credit the dividend to the lots that paid it, by shares held.
          var held = (lotsBySymbol[tx.symbol] || []).filter(function (l) { return l.remaining > EPS; });
          var tot = held.reduce(function (s, l) { return s + l.remaining; }, 0);
          lastDiv[tx.symbol] = held.map(function (l) { return { lot: l, w: l.remaining / tot }; });
          held.forEach(function (l) { l.dividends += amt * l.remaining / tot; l.dividendsTotal += amt * l.remaining / tot; });
        } else if (kind === 'reinvest') {
          var rcost = Math.abs(amt) > 0 ? Math.abs(amt) : q * tx.price;
          cash -= rcost;
          shares[tx.symbol] = (shares[tx.symbol] || 0) + q;
          takeIncome(rcost);
          // The new shares join the lots whose dividend bought them; the
          // dividend now lives in those shares instead of as cash.
          var alloc = lastDiv[tx.symbol];
          if (!alloc || !alloc.length) {
            var hl = (lotsBySymbol[tx.symbol] || []).filter(function (l) { return l.remaining > EPS; });
            var ht = hl.reduce(function (s, l) { return s + l.remaining; }, 0);
            alloc = hl.map(function (l) { return { lot: l, w: l.remaining / ht }; });
          }
          alloc.forEach(function (a) {
            a.lot.remaining += q * a.w; a.lot.dripShares += q * a.w; a.lot.dividends -= rcost * a.w;
          });
          if (!alloc.length) newLot(tx.symbol, d, q, rcost, { 'new': 0, reinvested: rcost, from: { income: rcost } }, false);
        } else if (kind === 'buy') {
          var cost = Math.abs(amt) > 0 ? Math.abs(amt) : q * tx.price;
          cash -= cost;
          shares[tx.symbol] = (shares[tx.symbol] || 0) + q;
          var funding = drawPool(cost);
          {
            buyRows.push({ date: d, symbol: tx.symbol, cost: cost, funding: funding });
            var ex = dayLot[tx.symbol];
            if (ex) {
              ex.shares += q; ex.remaining += q; ex.cost += cost; ex.basis += cost;
              ex.buyPrice = ex.cost / ex.shares;
              ex.fundingNew += funding['new']; ex.fundingReinvested += funding.reinvested;
              Object.keys(funding.from).forEach(function (o) { ex.fundingFrom[o] = (ex.fundingFrom[o] || 0) + funding.from[o]; });
            } else {
              dayLot[tx.symbol] = newLot(tx.symbol, d, q, cost, funding, true);
            }
          }
        } else if (kind === 'sale') {
          var proceeds = Math.abs(amt) > 0 ? Math.abs(amt) : q * tx.price;
          cash += proceeds;
          shares[tx.symbol] = (shares[tx.symbol] || 0) - q;
          var net = q > 0 ? proceeds / q : tx.price;
          var rem = q, gain = 0;
          var lots = openLots(tx.symbol);
          for (var i = 0; i < lots.length && rem > EPS; i++) {
            var lot = lots[i];
            if (lot.remaining <= EPS) continue;
            var take = Math.min(lot.remaining, rem);
            var pieceBasis = lot.basis * take / lot.remaining;
            var g = net * take - pieceBasis;
            lot.basis -= pieceBasis;
            lot.remaining = r6(lot.remaining - take);
            var last = lot.soldPieces[lot.soldPieces.length - 1];
            if (last && last.date === d && Math.abs(last.price - net) < 0.05) {
              // Same-day rows of one sale (whole + fractional) are one piece.
              last.price = (last.price * last.shares + net * take) / (last.shares + take);
              last.shares += take; last.gain += g; last.cost += pieceBasis;
            } else {
              lot.soldPieces.push({ shares: take, date: d, price: net, gain: g, cost: pieceBasis });
            }
            gain += g; rem -= take;
            addPool(take * net, 'reinvested', lot.visible ? lot.buyDate.slice(0, 4) : 'income');
          }
          if (rem > EPS) addPool(rem * net, 'reinvested', 'unknown');
          if (rem > 0.001) unmatched[tx.symbol] = (unmatched[tx.symbol] || 0) + rem;
          var prevSale = salesLog[salesLog.length - 1];
          if (prevSale && prevSale.date === d && prevSale.symbol === tx.symbol) {
            prevSale.shares += q; prevSale.proceeds += proceeds; prevSale.gain += gain;
          } else {
            salesLog.push({ date: d, symbol: tx.symbol, shares: q, proceeds: proceeds, gain: gain });
          }
        } else if (kind === 'split') {
          // Shares appear with no cash: scale the open lots up pro rata.
          var lotsS = (lotsBySymbol[tx.symbol] || []).filter(function (l) { return l.remaining > EPS; });
          var heldS = lotsS.reduce(function (s, l) { return s + l.remaining; }, 0);
          if (heldS > EPS) {
            var f = (heldS + q) / heldS;
            lotsS.forEach(function (l) {
              l.remaining *= f; l.shares *= f; l.dripShares *= f; l.buyPrice /= f;
              l.soldPieces.forEach(function (p) { p.shares *= f; p.price /= f; });
            });
          }
          shares[tx.symbol] = (shares[tx.symbol] || 0) + q;
        } else {
          cash += amt;
        }
      });
      // End-of-day value: every share (fractions included) at the day's
      // price, plus cash (which includes the money market, like Fidelity).
      var isEnd = d === endDate;
      var holdings = 0;
      Object.keys(shares).forEach(function (s) {
        if (Math.abs(shares[s]) > EPS) holdings += shares[s] * prices.on(s, d, isEnd);
      });
      var value = holdings + cash;
      // Time-weighted daily return; money arriving today is available all
      // day: r = V_today / (V_yesterday + flow_today) - 1.
      var base = prevValue + flowToday;
      var r = base > EPS ? value / base - 1 : 0;
      // Chart lines: the same deposits held in the benchmark (dollars), and
      // growth of $1 for you (time-weighted) and for the benchmark.
      shadowUnits += flowToday / idx(d);
      cum *= 1 + r;
      series.push({ date: d, value: value, holdings: holdings, cash: cash, flow: flowToday, r: r,
        shadow: shadowUnits * idx(d), invested: (series.length ? series[series.length - 1].invested : 0) + flowToday,
        cum: cum, benchCum: idx(d) / idx(startDate) });
      prevValue = value;
      // Reconcile rebuilt cash with Fidelity's own Cash Balance column.
      var bals = (dayMap[d] || []).map(function (it) { return it.tx.cashBalance; })
        .filter(function (b) { return typeof b === 'number' && !isNaN(b); });
      if (bals.length) {
        cashChecks.checked++;
        var ok = bals.some(function (b) { return Math.abs(b - cash) < 0.02; });
        if (ok) cashChecks.matched++;
        else cashChecks.mismatches.push({ date: d, rebuilt: cash, fidelity: bals });
      }
    });
    Object.keys(unmatched).forEach(function (s) {
      warnings.push('Sold ' + unmatched[s].toFixed(3) + ' more ' + s + ' shares than the uploaded files show you buying — upload any missing years.');
    });
    var noHist = Object.keys(shares).filter(function (s) {
      return !prices.hasHistory(s);
    });
    if (noHist.length) {
      warnings.push('No daily price history yet for ' + noHist.join(', ') +
        ' — between trades they are valued at your own trade prices. Press Refresh prices.');
    }
    if (!options.indexIsTotalReturn) {
      warnings.push('Benchmark is the S&P 500 price index (dividends left out) until the total-return series is fetched — press Refresh prices.');
    }

    // ---- period stats (all years + each calendar year) ----
    function periodStats(fromDate, toDate) {
      var inP = series.filter(function (s) { return s.date >= fromDate && s.date <= toDate; });
      if (!inP.length) return null;
      var before = series.filter(function (s) { return s.date < fromDate; });
      var startRow = before.length ? before[before.length - 1] : null;
      var startValue = startRow ? startRow.value : 0;
      var endRow = inP[inP.length - 1];
      var twr = inP.reduce(function (p, s) { return p * (1 + s.r); }, 1) - 1;
      var refStart = startRow ? idx(startRow.date) : idx(inP[0].date);
      var refEnd = idx(endRow.date);
      var spTwr = refEnd / refStart - 1;
      var pFlows = flows.filter(function (f) { return f.date >= fromDate && f.date <= toDate; });
      var netFlows = pFlows.reduce(function (s, f) { return s + f.amount; }, 0);
      var inflows = pFlows.reduce(function (s, f) { return s + (f.amount > 0 ? f.amount : 0); }, 0);
      // Same money in the S&P: the starting balance plus each deposit,
      // bought at that day's close (dividends reinvested), held to the end.
      var baseline = startValue * (refEnd / refStart - 1) +
        pFlows.reduce(function (s, f) { return s + f.amount * (refEnd / idx(f.date) - 1); }, 0);
      var actual = endRow.value - startValue - netFlows;
      var income = incomeRows.filter(function (x) { return x.date >= fromDate && x.date <= toDate; })
        .reduce(function (s, x) { return s + x.amount; }, 0);
      var nDays = (Date.parse(endRow.date) - Date.parse(startRow ? startRow.date : inP[0].date)) / 864e5;
      function ann(x) { return nDays > 0 ? Math.pow(1 + x, 365.25 / nDays) - 1 : x; }
      return {
        from: startRow ? startRow.date : inP[0].date, to: endRow.date,
        moneyIn: netFlows, inflows: inflows, income: income,
        startValue: startValue, endValue: endRow.value, endCash: endRow.cash,
        actual: actual, baseline: baseline, diff: actual - baseline,
        actualPct: twr * 100, baselinePct: spTwr * 100,
        diffPp: (twr - spTwr) * 100,
        actualAnnPct: ann(twr) * 100, baselineAnnPct: ann(spTwr) * 100, days: nDays
      };
    }
    var all = periodStats(startDate, endDate);

    // ---- per-purchase cards (window-matched against the benchmark) ----
    purchases.forEach(function (lot) {
      lot.shares = r6(lot.shares);
      lot.remaining = r6(lot.remaining);
      if (lot.remaining < EPS) lot.remaining = 0;
      lot.pieces = [];
      lot.soldPieces.forEach(function (sp) {
        var pc = sp.cost;
        lot.pieces.push({
          shares: r6(sp.shares), exitDate: sp.date, exitPrice: sp.price, gain: sp.gain, cost: pc,
          gainPct: pc > 0 ? sp.gain / pc : 0,
          indexPct: idx(sp.date) / idx(lot.buyDate) - 1, held: false
        });
      });
      if (lot.remaining > 0) {
        var cur = prices.on(lot.symbol, endDate, true) || lot.buyPrice;
        var unreal = cur * lot.remaining - lot.basis;
        var pc2 = lot.basis;
        lot.pieces.push({
          shares: lot.remaining, exitDate: endDate, exitPrice: cur, gain: unreal, cost: pc2,
          gainPct: pc2 > 0 ? unreal / pc2 : 0,
          indexPct: idx(endDate) / idx(lot.buyDate) - 1, held: true
        });
        lot.currentPrice = cur;
      }
      lot.totalGain = lot.pieces.reduce(function (s, p) { return s + p.gain; }, 0) + lot.dividends;
      lot.youPct = lot.cost > 0 ? lot.totalGain / lot.cost : 0;
      var wsum = lot.pieces.reduce(function (s, p) { return s + p.cost * p.indexPct; }, 0);
      lot.indexPct = lot.cost > 0 ? wsum / lot.cost : 0;
      lot.pp = (lot.youPct - lot.indexPct) * 100;
      lot.indexGain = lot.indexPct * lot.cost;
      lot.extra = lot.totalGain - lot.indexGain;
      lot.status = lot.remaining === 0 ? 'sold' : (lot.soldPieces.length ? 'partly' : 'held');
    });

    // ---- year views: the purchases made that year, each followed from its
    // buy date to its sale (or today if still held), against the benchmark
    // over exactly those dates. Year-end is not a stopping point.
    var cohorts = {};
    var buysAll = { year: 'all', moneyIn: 0, actual: 0, baseline: 0, newMoney: 0, reinvested: 0,
      from: '9999', to: '0000', count: 0, dividends: 0 };
    purchases.forEach(function (l) {
      var yy = l.buyDate.slice(0, 4);
      var c = cohorts[yy] || (cohorts[yy] = { year: yy, moneyIn: 0, actual: 0, baseline: 0,
        newMoney: 0, reinvested: 0, from: l.buyDate, to: l.buyDate, count: 0, dividends: 0 });
      [c, buysAll].forEach(function (c) {
        c.moneyIn += l.cost; c.actual += l.totalGain; c.baseline += l.indexGain;
        c.newMoney += l.fundingNew; c.reinvested += l.fundingReinvested; c.count++;
        c.dividends += l.dividendsTotal;
        if (l.buyDate < c.from) c.from = l.buyDate;
        l.pieces.forEach(function (p) { if (p.exitDate > c.to) c.to = p.exitDate; });
      });
    });
    [buysAll].concat(Object.keys(cohorts).map(function (k) { return cohorts[k]; })).forEach(function (c) {
      c.diff = c.actual - c.baseline;
      c.actualPct = c.moneyIn > 0 ? c.actual / c.moneyIn * 100 : 0;
      c.baselinePct = c.moneyIn > 0 ? c.baseline / c.moneyIn * 100 : 0;
      c.diffPp = c.actualPct - c.baselinePct;
      c.mode = 'purchases';
    });

    function inScope(date, year) { return year === null || date.slice(0, 4) === year; }
    function grossOf(year) {
      var t = 0, nm = 0, rv = 0;
      buyRows.forEach(function (b) {
        if (!inScope(b.date, year)) return;
        t += b.cost; nm += b.funding['new']; rv += b.funding.reinvested;
      });
      return { total: t, newMoney: nm, reinvested: rv };
    }
    var purchasesByYear = {}, grossByYear = {};
    purchases.forEach(function (l) {
      var yy = l.buyDate.slice(0, 4);
      (purchasesByYear[yy] = purchasesByYear[yy] || []).push(l);
    });
    Object.keys(purchasesByYear).forEach(function (yy) { grossByYear[yy] = grossOf(yy); });

    // ---- "Follow the money", by calendar period ----
    function range(list) {
      if (!list.length) return null;
      return { from: list[0].date, to: list[list.length - 1].date };
    }
    function journeyFor(year) {
      var arrs = flows.filter(function (f) { return inScope(f.date, year) && f.amount > 0; });
      var firstBuys = [], reinvestedBuys = [];
      purchases.forEach(function (lot) {
        if (!inScope(lot.buyDate, year) || !(lot.cost > 0)) return;
        if (lot.fundingNew > 0.5) firstBuys.push({ date: lot.buyDate, symbol: lot.symbol,
          amount: lot.fundingNew, gain: lot.totalGain * lot.fundingNew / lot.cost });
        if (lot.fundingReinvested > 0.5) reinvestedBuys.push({ date: lot.buyDate, symbol: lot.symbol,
          amount: lot.fundingReinvested, gain: lot.totalGain * lot.fundingReinvested / lot.cost });
      });
      var sales = salesLog.filter(function (s) { return inScope(s.date, year); })
        .map(function (s) { return { date: s.date, symbol: s.symbol, proceeds: s.proceeds }; });
      var phase = sales.map(function (s) { return s.date; })
        .concat(reinvestedBuys.map(function (b) { return b.date; })).sort();
      var sum = function (l, k) { return l.reduce(function (s, x) { return s + x[k]; }, 0); };
      return {
        arrivals: arrs, arrivalsRange: range(arrs),
        firstBuys: firstBuys, firstBuysRange: range(firstBuys),
        firstBuysTotal: sum(firstBuys, 'amount'), firstBuysGain: sum(firstBuys, 'gain'),
        sales: sales, salesRange: range(sales),
        reinvested: reinvestedBuys, reinvestedRange: range(reinvestedBuys),
        reinvestedTotal: sum(reinvestedBuys, 'amount'), reinvestedGain: sum(reinvestedBuys, 'gain'),
        phaseRange: phase.length ? { from: phase[0], to: phase[phase.length - 1] } : null
      };
    }
    // Year journey: that year's buys -> how they were sold -> which later
    // buys the proceeds paid for.
    // yy === null: every purchase (the "All" year view).
    function yearJourney(yy) {
      var lots = purchases.filter(function (l) { return yy === null || l.buyDate.slice(0, 4) === yy; });
      var buys = lots.map(function (l) {
        return { date: l.buyDate, symbol: l.symbol, amount: l.cost, gain: l.totalGain,
          newMoney: l.fundingNew, reinvested: l.fundingReinvested };
      });
      var sales = [], heldValue = 0, heldCount = 0;
      lots.forEach(function (l) {
        l.pieces.forEach(function (p) {
          if (p.held) { heldValue += p.shares * p.exitPrice; heldCount++; return; }
          sales.push({ date: p.exitDate, symbol: l.symbol, shares: p.shares,
            proceeds: p.shares * p.exitPrice, gain: p.gain });
        });
      });
      sales.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : (a.symbol < b.symbol ? -1 : 1)); });
      var later = [];
      purchases.forEach(function (l) {
        var amt = 0;
        Object.keys(l.fundingFrom || {}).forEach(function (o) {
          if (yy === null ? /^\d{4}$/.test(o) : o === yy) amt += l.fundingFrom[o];
        });
        if (amt > 0.5) later.push({ date: l.buyDate, symbol: l.symbol, amount: amt, gain: l.totalGain * amt / l.cost });
      });
      later.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var sum = function (l, k) { return l.reduce(function (s, x) { return s + x[k]; }, 0); };
      // Money that came into the account in this period (deposits,
      // rollovers, transfers, Roth conversions) — shown apart from buys.
      var arrivals = flows.filter(function (f) { return f.amount > 0 && (yy === null || f.date.slice(0, 4) === yy); });
      return {
        mode: 'purchases',
        arrivals: arrivals, arrivalsRange: range(arrivals), arrivalsTotal: sum(arrivals, 'amount'),
        buys: buys, buysRange: range(buys), buysTotal: sum(buys, 'amount'),
        sales: sales, salesRange: range(sales), salesTotal: sum(sales, 'proceeds'), salesGain: sum(sales, 'gain'),
        heldValue: heldValue, heldCount: heldCount,
        later: later, laterRange: range(later), laterTotal: sum(later, 'amount'), laterGain: sum(later, 'gain')
      };
    }
    var journeys = { all: journeyFor(null), buysAll: yearJourney(null) };
    Object.keys(cohorts).forEach(function (yy) { journeys[yy] = yearJourney(yy); });

    function purchaseAgg(lots) {
      if (!lots.length) return { dollarWeightedPp: 0, plainAveragePp: 0, count: 0 };
      var c = 0, g = 0, ig = 0, pp = 0;
      lots.forEach(function (l) { c += l.cost; g += l.totalGain; ig += l.indexGain; pp += l.pp; });
      return { dollarWeightedPp: c > 0 ? (g - ig) / c * 100 : 0, plainAveragePp: pp / lots.length, count: lots.length };
    }
    var aggByYear = {};
    Object.keys(purchasesByYear).forEach(function (yy) { aggByYear[yy] = purchaseAgg(purchasesByYear[yy]); });

    var endRow = series[series.length - 1];
    var holdingsNow = {};
    Object.keys(shares).forEach(function (s) {
      if (Math.abs(shares[s]) > 0.0005) holdingsNow[s] = { shares: r6(shares[s]), price: prices.on(s, endDate, true) };
    });
    if (cashChecks.checked && cashChecks.matched < cashChecks.checked) {
      var mm = cashChecks.mismatches[cashChecks.mismatches.length - 1];
      warnings.push('Rebuilt cash differs from Fidelity’s Cash Balance on ' +
        (cashChecks.checked - cashChecks.matched) + ' of ' + cashChecks.checked + ' days (latest ' + mm.date +
        ': rebuilt $' + mm.rebuilt.toFixed(2) + ' vs Fidelity $' + mm.fidelity[0].toFixed(2) + ').');
    }

    return {
      endDate: endDate, endClose: endClose, startDate: startDate,
      indexIsTotalReturn: !!options.indexIsTotalReturn,
      moneyIn: all.moneyIn, inflows: all.inflows, income: all.income,
      actualGain: all.actual, baselineGain: all.baseline, diff: all.diff,
      actualPct: all.actualPct, baselinePct: all.baselinePct, diffPp: all.diffPp,
      actualAnnPct: all.actualAnnPct, baselineAnnPct: all.baselineAnnPct,
      accountValue: endRow.value, cash: endRow.cash, holdingsValue: endRow.holdings,
      holdings: holdingsNow, shadowValue: all.moneyIn + all.baseline,
      cashCheck: { checked: cashChecks.checked, matched: cashChecks.matched },
      series: series, flows: flows,
      cohorts: cohorts, buysAll: buysAll,
      dividendRows: incomeRows,
      gross: grossOf(null), grossByYear: grossByYear,
      purchases: purchases, purchasesByYear: purchasesByYear,
      journeys: journeys,
      arrivals: flows.filter(function (f) { return f.amount > 0; }),
      proxies: [], warnings: warnings,
      ignoredRows: ignored, cashRows: cashRows,
      purchaseAgg: purchaseAgg(purchases), purchaseAggByYear: aggByYear,
      symbolsEverHeld: Object.keys(shares).sort()
    };
  }

  function emptyResult(endDate, endClose, warnings) {
    var j = { arrivals: [], arrivalsRange: null, firstBuys: [], firstBuysRange: null, firstBuysTotal: 0,
      firstBuysGain: 0, sales: [], salesRange: null, reinvested: [], reinvestedRange: null,
      reinvestedTotal: 0, reinvestedGain: 0, phaseRange: null };
    return { endDate: endDate, endClose: endClose, moneyIn: 0, inflows: 0, income: 0, actualGain: 0,
      baselineGain: 0, diff: 0, actualPct: 0, baselinePct: 0, diffPp: 0, actualAnnPct: 0, baselineAnnPct: 0,
      accountValue: 0, cash: 0, holdingsValue: 0, holdings: {}, shadowValue: 0,
      cashCheck: { checked: 0, matched: 0 }, series: [], flows: [], cohorts: {},
      gross: { total: 0, newMoney: 0, reinvested: 0 }, grossByYear: {}, purchases: [], purchasesByYear: {},
      journeys: { all: j }, arrivals: [], proxies: [], warnings: warnings, ignoredRows: 0, cashRows: 0,
      purchaseAgg: { dollarWeightedPp: 0, plainAveragePp: 0, count: 0 }, purchaseAggByYear: {},
      symbolsEverHeld: [] };
  }

  // ---------------------------------------------------------------- Accounts
  // Fidelity names exports "History_for_Account_<number>_<year>.csv".
  function accountOf(tx) {
    var m = String(tx.filename || '').match(/Account[_ -]?([A-Za-z0-9]+?)(?:[_ -]\d{4})?\.csv$/i) ||
      String(tx.filename || '').match(/Account[_ -]?([A-Za-z0-9]+)/i);
    return m ? m[1] : 'default';
  }
  // Best guess at the account type from what happens in it. The user can
  // change it on the Data page.
  function inferAccountType(txs) {
    var acts = txs.map(function (t) { return t.action.toUpperCase(); });
    function has(re) { return acts.some(function (a) { return re.test(a); }); }
    var conv = txs.filter(function (t) { return /CONVER/i.test(t.action); });
    if (conv.some(function (t) { return t.amount > 0; })) return 'Roth IRA';
    if (has(/CONTRIBUTION (CURRENT|PRIOR) YEAR/)) return has(/ROTH/) ? 'Roth IRA' : 'Traditional IRA';
    if (has(/ROLLOVER/)) return has(/ROTH/) ? 'Roth IRA' : 'Traditional IRA';
    if (has(/EMPLOYEE|EMPLOYER|PAYROLL/)) return '401k';
    return 'Brokerage';
  }
  // Monthly returns from a computed result: time-weighted for the account,
  // total return for the S&P 500. Returns [['Mar 2022', you%, sp%], ...].
  function monthlyReturns(result) {
    var out = [], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var s = result.series || [];
    var prev = { cum: 1, bench: s.length ? s[0].benchCum : 1 };
    for (var i = 0; i < s.length; i++) {
      var ym = s[i].date.slice(0, 7);
      if (i === s.length - 1 || s[i + 1].date.slice(0, 7) !== ym) {
        out.push([MON[+ym.slice(5) - 1] + ' ' + ym.slice(0, 4), (s[i].cum / prev.cum - 1) * 100,
          (s[i].benchCum / prev.bench - 1) * 100, s[i].date]);
        prev = { cum: s[i].cum, bench: s[i].benchCum };
      }
    }
    return out;
  }

  // Benchmark series: the S&P 500 total-return index, extended past its
  // last date with the price index's moves (the total-return index can lag
  // a day, and intraday it may not update). Falls back to the price index.
  function buildBenchmark(trRows, priceRows) {
    var price = (priceRows || []).slice().sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    var tr = (trRows || []).filter(function (r) { return r && r[1] > 0; })
      .slice().sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    if (!tr.length) return { rows: price, isTotalReturn: false };
    var ps = new IndexSeries(price.length ? price : tr);
    var last = tr[tr.length - 1];
    var pLast = ps.closeOnOrBefore(last[0]);
    var out = tr.slice();
    if (pLast) {
      price.forEach(function (r) {
        if (r[0] > last[0]) out.push([r[0], last[1] * r[1] / pLast]);
      });
    }
    return { rows: out, isTotalReturn: true };
  }

  return {
    parseCSVText: parseCSVText,
    parseNumber: parseNumber,
    parseFidelityDate: parseFidelityDate,
    parseFidelityCSV: parseFidelityCSV,
    contentKey: contentKey,
    assignOccurrenceKeys: assignOccurrenceKeys,
    mergeTransactions: mergeTransactions,
    IndexSeries: IndexSeries,
    buildBenchmark: buildBenchmark,
    accountOf: accountOf, inferAccountType: inferAccountType, monthlyReturns: monthlyReturns,
    classify: classify,
    compute: compute
  };
});
