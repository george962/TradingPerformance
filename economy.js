/* Economy & market outlook — market-regime rules.
 *
 * Situation (rules fixed in advance, not tuned):
 *   trend:   S&P 500 below its 200-day average = downtrend
 *   warning: Sahm rule ≥ 0.5 (unemployment rising fast)
 *   warning: 10-yr Treasury yield below the 3-month yield at any point in
 *            the past 12 months (inverted yield curve)
 *   warning: Baa corporate yield minus 10-yr Treasury up ≥ 0.5 pts in
 *            6 months (credit spreads widening)
 * Economy data is used only once published (about 5 weeks after the month).
 *
 * Odds come from regime-table.json, built by a separate backtest script:
 * every month of the S&P 500 since 1960, grouped by situation, and what the
 * S&P did over the next 1/3/6/12 months. Walk-forward test (1975 → today):
 * knowing the situation made the odds of another 10% drop more accurate than
 * the long-run average; the odds of "higher" improved only slightly.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Economy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function mean(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }

  function monthlyAsOf(series, asOf) {
    if (!series || !series.length) return [];
    var cut = new Date(Date.parse(asOf + 'T00:00:00Z') - 38 * 864e5).toISOString().slice(0, 10);
    return series.filter(function (r) { return r[0] <= cut; });
  }

  function marketRegime(indexRows, macro, asOf) {
    var rows = asOf ? indexRows.filter(function (r) { return r[0] <= asOf; }) : indexRows;
    if (!rows.length) return null;
    var d = asOf || rows[rows.length - 1][0];
    var closes = rows.slice(-200).map(function (r) { return r[1]; });
    var last = rows[rows.length - 1][1];
    var sma200 = closes.length >= 200 ? mean(closes) : NaN;
    var hi = Math.max.apply(null, rows.slice(-252).map(function (r) { return r[1]; }));
    var out = { asOf: d, spx: last, sma200: sma200, trendDown: isNum(sma200) && last < sma200, fromHigh: last / hi - 1,
      vsSma: isNum(sma200) ? last / sma200 - 1 : NaN, warnings: [], checks: {}, haveMacro: false };
    var m = macro || {};
    var sahm = monthlyAsOf(m.SAHMREALTIME, d), gs10 = monthlyAsOf(m.GS10, d), tb3 = monthlyAsOf(m.TB3MS, d), baa = monthlyAsOf(m.BAA, d);
    if (sahm.length) {
      var sv = sahm[sahm.length - 1][1];
      out.checks.sahm = { value: sv, month: sahm[sahm.length - 1][0], on: sv >= 0.5 };
      if (sv >= 0.5) out.warnings.push('sahm');
    }
    if (gs10.length && tb3.length) {
      var tbm = {}; tb3.forEach(function (r) { tbm[r[0]] = r[1]; });
      var sp = gs10.filter(function (r) { return tbm[r[0]] !== undefined; }).map(function (r) { return [r[0], r[1] - tbm[r[0]]]; });
      var last12 = sp.slice(-12), inv = last12.some(function (r) { return r[1] < 0; });
      out.checks.curve = { value: sp.length ? sp[sp.length - 1][1] : NaN, month: sp.length ? sp[sp.length - 1][0] : '', invertedLast12: inv, on: inv };
      if (inv) out.warnings.push('curve');
    }
    if (baa.length && gs10.length) {
      var gm = {}; gs10.forEach(function (r) { gm[r[0]] = r[1]; });
      var cs = baa.filter(function (r) { return gm[r[0]] !== undefined; }).map(function (r) { return [r[0], r[1] - gm[r[0]]]; });
      if (cs.length > 6) {
        var chg = cs[cs.length - 1][1] - cs[cs.length - 7][1];
        out.checks.credit = { value: cs[cs.length - 1][1], change6m: chg, month: cs[cs.length - 1][0], on: chg >= 0.5 };
        if (chg >= 0.5) out.warnings.push('credit');
      }
    }
    out.haveMacro = !!(out.checks.sahm || out.checks.curve || out.checks.credit);
    out.key = (out.trendDown ? 'down' : 'up') + '-' + (out.warnings.length ? 'warn' : 'clear');
    out.label = (out.trendDown ? 'Market downtrend' : 'Market uptrend') + (out.warnings.length ? ' with recession warnings' : ', no recession warnings');
    return out;
  }

  // What the S&P did next, historically, in this situation vs in all months.
  function outlook(regime, rt) {
    if (!regime || !rt || !rt.table) return null;
    var cur = rt.table[regime.key], all = rt.table.all;
    if (!cur) return null;
    var hz = [1, 3, 6, 12].map(function (m) {
      var c = cur.h[String(m)], a = all.h[String(m)];
      return { months: m, n: c.n, pUp: c.pUp, pDrop10: c.pDrop10, median: c.median, p10: c.p10, p90: c.p90,
        allPUp: a.pUp, allPDrop10: a.pDrop10, allMedian: a.median };
    });
    return { key: regime.key, months: cur.n, horizons: hz, pRec12: cur.pRec12, allPRec12: all.pRec12,
      ifRecession: cur.rec, ifNoRecession: cur.noRec, selloffs: rt.selloffs, walkForward: rt.walkForward, built: rt.built };
  }

  // Which holdings move together: correlation of daily returns over the
  // last year (≥ 0.7 = they rise and fall together — effectively one bet).
  function together(history, symbols, weights, opts) {
    opts = opts || {};
    var LOOK = opts.days || 252, CUT = opts.threshold || 0.7;
    var rets = {};
    symbols.forEach(function (s) {
      var h = (history[s] || []).slice(-(LOOK + 1));
      var map = {};
      for (var i = 1; i < h.length; i++) if (h[i - 1][1] > 0) map[h[i][0]] = h[i][1] / h[i - 1][1] - 1;
      rets[s] = map;
    });
    function corr(a, b) {
      var xs = [], ys = [];
      Object.keys(rets[a]).forEach(function (d) { if (rets[b][d] !== undefined) { xs.push(rets[a][d]); ys.push(rets[b][d]); } });
      if (xs.length < 60) return NaN;
      var mx = mean(xs), my = mean(ys), sxy = 0, sxx = 0, syy = 0;
      for (var i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); syy += (ys[i] - my) * (ys[i] - my); }
      return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
    }
    var pairs = [];
    for (var i = 0; i < symbols.length; i++) for (var j = i + 1; j < symbols.length; j++) {
      var c = corr(symbols[i], symbols[j]);
      if (isNum(c)) pairs.push({ a: symbols[i], b: symbols[j], c: c });
    }
    // Groups: link any two holdings at or above the threshold.
    var parent = {};
    symbols.forEach(function (s) { parent[s] = s; });
    function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
    pairs.forEach(function (p) { if (p.c >= CUT) parent[find(p.a)] = find(p.b); });
    var g = {};
    symbols.forEach(function (s) { (g[find(s)] = g[find(s)] || []).push(s); });
    var groups = Object.keys(g).map(function (k) { return g[k]; }).filter(function (m) { return m.length > 1; }).map(function (m) {
      var ps = pairs.filter(function (p) { return m.indexOf(p.a) >= 0 && m.indexOf(p.b) >= 0; });
      return { members: m.sort(function (a, b) { return (weights[b] || 0) - (weights[a] || 0); }),
        avg: ps.length ? mean(ps.map(function (p) { return p.c; })) : NaN,
        weight: m.reduce(function (s, x) { return s + (weights[x] || 0); }, 0) };
    }).sort(function (a, b) { return b.weight - a.weight; });
    return { pairs: pairs.sort(function (a, b) { return b.c - a.c; }), groups: groups, threshold: CUT };
  }

  function fearGreedLabel(v) {
    return !isNum(v) ? '' : v < 25 ? 'Extreme fear' : v < 45 ? 'Fear' : v <= 55 ? 'Neutral' : v <= 75 ? 'Greed' : 'Extreme greed';
  }

  return { marketRegime: marketRegime, outlook: outlook, together: together, fearGreedLabel: fearGreedLabel, monthlyAsOf: monthlyAsOf };
});
