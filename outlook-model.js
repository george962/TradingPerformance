/* Outlook model — many economic and market inputs, tested walk-forward.
 *
 * Questions (each its own model): S&P 500 higher in 3 months; higher in 12
 * months; a further 10% drop within 3 months; a US recession within 12
 * months (NBER dates).
 *
 * Inputs come in groups (market trend, valuation, yield curve, credit,
 * jobs, activity, global, policy uncertainty, sentiment, financial
 * conditions, inflation & Fed). Each month uses only data that had been
 * published by then (monthly economic data lagged 1–2 months).
 *
 * Method: L2-regularized logistic regression, refit every year on all
 * earlier months whose outcome was already known. Groups are chosen on
 * 1975–1999 only (forward selection: a group is added only if it improves
 * the accuracy score by ≥ 1.5%); 2000 → today is a held-out test the
 * selection never saw. Score: Brier (mean squared error of the
 * probability; lower is better) vs. the long-run average up to that month.
 * Outcomes of neighbouring months overlap, so the effective sample is
 * smaller than the month count — the held-out test is the honest check.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OutlookModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NaN_ = NaN;
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function ym(d) { return d.slice(0, 7); }
  function addM(m, k) { var y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + k; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; return y + '-' + String(mo + 1).padStart(2, '0'); }

  // ---------------------------------------------------------------- inputs
  var GROUPS = [
    { id: 'trend', label: 'Market trend', what: 'S&P vs. its 10-month average, 12-month change, distance from high, recent volatility' },
    { id: 'valuation', label: 'Valuation', what: 'Shiller CAPE and earnings yield vs. the 10-yr Treasury' },
    { id: 'curve', label: 'Yield curve', what: '10-yr minus 3-month Treasury, and its low over the past year' },
    { id: 'credit', label: 'Credit spreads', what: 'Baa corporate minus 10-yr Treasury, level and 6-month change' },
    { id: 'jobs', label: 'Jobs', what: 'Sahm rule (real-time) and weekly jobless claims vs. a year ago' },
    { id: 'activity', label: 'Economic activity', what: 'industrial production, building permits, OECD leading indicator (US)' },
    { id: 'global', label: 'Global economy', what: 'OECD leading indicator (all OECD), oil price, US dollar' },
    { id: 'policy', label: 'Policy uncertainty (politics)', what: 'Economic Policy Uncertainty index — news coverage of policy, tariffs, elections, regulation' },
    { id: 'sentiment', label: 'Sentiment', what: 'University of Michigan consumer sentiment and the VIX' },
    { id: 'fincond', label: 'Financial conditions', what: 'Chicago Fed National Financial Conditions Index' },
    { id: 'inflation', label: 'Inflation & the Fed', what: 'CPI inflation and the change in the Fed funds rate' }
  ];
  // FRED series the server downloads (free, no key) + where else data comes from.
  var FRED = ['SAHMREALTIME', 'GS10', 'TB3MS', 'BAA', 'USREC', 'ICSA', 'INDPRO', 'PERMIT', 'USALOLITONOSTSAM',
    'OECDLOLITONOSTSAM', 'WTISPLC', 'DTWEXBGS', 'USEPUINDXM', 'UMCSENT', 'VIXCLS', 'NFCI', 'CPIAUCSL', 'FEDFUNDS'];

  // Monthly view of a [[date, value]] series: mean (or last) per month.
  function monthly(rows, how) {
    var out = {};
    (rows || []).forEach(function (r) {
      if (!isNum(r[1])) return;
      var k = ym(r[0]), o = out[k] || (out[k] = { s: 0, n: 0, last: NaN_ });
      o.s += r[1]; o.n++; o.last = r[1];
    });
    var m = {};
    Object.keys(out).forEach(function (k) { m[k] = how === 'last' ? out[k].last : out[k].s / out[k].n; });
    return m;
  }

  function buildTable(series, opts) {
    opts = opts || {};
    var daily = (series.SPX || []).filter(function (r) { return isNum(r[1]) && r[1] > 0; });
    var P = monthly(daily, 'last');
    var months = Object.keys(P).sort();
    if (!months.length) return [];
    var M = {};
    FRED.forEach(function (id) { M[id] = monthly(series[id], id === 'USREC' ? 'last' : 'mean'); });
    var pe = monthly(series.PE10, 'last');
    // Daily index for volatility and "further 10% drop" (uses daily lows of closes).
    var dIdx = {}; daily.forEach(function (r, i) { dIdx[ym(r[0])] = i; });
    function lagv(id, m, lag) { var v = M[id][addM(m, -lag)]; return isNum(v) ? v : NaN_; }
    function chg(id, m, lag, k, log) {
      var a = lagv(id, m, lag), b = lagv(id, m, lag + k);
      return isNum(a) && isNum(b) && (!log || (a > 0 && b > 0)) ? (log ? Math.log(a / b) : a - b) : NaN_;
    }
    // CAPE: carry the last published value forward with the price (earnings move slowly).
    var lastPe = null;
    var rows = months.map(function (m, i) {
      var p = P[m], f = {};
      var ma = []; for (var k = 0; k < 10 && i - k >= 0; k++) ma.push(P[months[i - k]]);
      f.trend10 = ma.length === 10 ? Math.log(p / (ma.reduce(function (s, x) { return s + x; }, 0) / 10)) : NaN_;
      f.mom12 = i >= 12 ? Math.log(p / P[months[i - 12]]) : NaN_;
      var hi = -Infinity; for (k = 0; k < 12 && i - k >= 0; k++) hi = Math.max(hi, P[months[i - k]]);
      f.dd12 = i >= 11 ? p / hi - 1 : NaN_;
      var di = dIdx[m];
      if (di >= 63) {
        var rs = []; for (k = di - 62; k <= di; k++) rs.push(Math.log(daily[k][1] / daily[k - 1][1]));
        var mu = rs.reduce(function (s, x) { return s + x; }, 0) / rs.length;
        f.vol3 = Math.sqrt(rs.reduce(function (s, x) { return s + (x - mu) * (x - mu); }, 0) / (rs.length - 1) * 252);
      } else f.vol3 = NaN_;
      var peV = pe[addM(m, -1)];
      if (isNum(peV) && peV > 0) lastPe = { v: peV, p: P[addM(m, -1)] || p };
      var cape = isNum(peV) && peV > 0 ? peV : (lastPe ? lastPe.v * p / lastPe.p : NaN_);
      var g10 = lagv('GS10', m, 1);
      f.logCape = isNum(cape) ? Math.log(cape) : NaN_;
      f.eyGap = isNum(cape) && isNum(g10) ? 100 / cape - g10 : NaN_;
      var spread = function (mm) { var a = lagv('GS10', mm, 1), b = lagv('TB3MS', mm, 1); return isNum(a) && isNum(b) ? a - b : NaN_; };
      f.curve = spread(m);
      var mn = Infinity, any = false;
      for (k = 0; k < 12; k++) { var s = spread(addM(m, -k)); if (isNum(s)) { mn = Math.min(mn, s); any = true; } }
      f.curveMin12 = any ? mn : NaN_;
      var cs = function (mm) { var a = lagv('BAA', mm, 1), b = lagv('GS10', mm, 1); return isNum(a) && isNum(b) ? a - b : NaN_; };
      f.baa = cs(m); f.baaChg6 = isNum(cs(m)) && isNum(cs(addM(m, -6))) ? cs(m) - cs(addM(m, -6)) : NaN_;
      f.sahm = lagv('SAHMREALTIME', m, 1);
      f.claims = chg('ICSA', m, 0, 12, true);
      f.indpro = chg('INDPRO', m, 2, 12, true);
      f.permit = chg('PERMIT', m, 2, 12, true);
      f.cliUs = chg('USALOLITONOSTSAM', m, 2, 6, false);
      f.cliOecd = chg('OECDLOLITONOSTSAM', m, 2, 6, false);
      f.oil = chg('WTISPLC', m, 1, 12, true);
      f.dollar = chg('DTWEXBGS', m, 0, 12, true);
      var epu = lagv('USEPUINDXM', m, 1);
      f.epu = isNum(epu) && epu > 0 ? Math.log(epu) : NaN_;
      f.epuChg = chg('USEPUINDXM', m, 1, 12, true);
      f.umcsent = lagv('UMCSENT', m, 1);
      f.vix = lagv('VIXCLS', m, 0);
      f.nfci = lagv('NFCI', m, 0);
      f.cpi = chg('CPIAUCSL', m, 2, 12, true);
      f.fedChg = chg('FEDFUNDS', m, 1, 12, false);
      // Outcomes (null = not known yet).
      var t = {};
      t.up3 = i + 3 < months.length ? (P[months[i + 3]] > p ? 1 : 0) : null;
      t.up12 = i + 12 < months.length ? (P[months[i + 12]] > p ? 1 : 0) : null;
      if (isNum(di) && i + 3 < months.length) {
        var end = dIdx[months[i + 3]], low = Infinity;
        for (k = di + 1; k <= end; k++) low = Math.min(low, daily[k][1]);
        t.drop10 = low / p - 1 <= -0.10 ? 1 : 0;
      } else t.drop10 = null;
      var recKnown = true, rec = 0;
      for (k = 1; k <= 12; k++) { var r = M.USREC[addM(m, k)]; if (!isNum(r)) { recKnown = false; break; } if (r >= 1) rec = 1; }
      t.rec12 = recKnown ? rec : null;
      return { m: m, p: p, f: f, t: t };
    });
    return rows;
  }
  var FEATS = {
    trend: ['trend10', 'mom12', 'dd12', 'vol3'], valuation: ['logCape', 'eyGap'], curve: ['curve', 'curveMin12'],
    credit: ['baa', 'baaChg6'], jobs: ['sahm', 'claims'], activity: ['indpro', 'permit', 'cliUs'],
    global: ['cliOecd', 'oil', 'dollar'], policy: ['epu', 'epuChg'], sentiment: ['umcsent', 'vix'],
    fincond: ['nfci'], inflation: ['cpi', 'fedChg']
  };
  var TARGETS = [
    { id: 'up3', h: 3, q: 'S&P 500 higher in 3 months' },
    { id: 'up12', h: 12, q: 'S&P 500 higher in 12 months' },
    { id: 'drop10', h: 3, q: 'A further 10% drop within 3 months' },
    { id: 'rec12', h: 12, q: 'A US recession within 12 months' }
  ];

  // ---------------------------------------------------------------- logistic
  function sigmoid(z) { return z > 35 ? 1 : z < -35 ? 0 : 1 / (1 + Math.exp(-z)); }
  function solve(A, b) {
    var n = b.length, M = A.map(function (r, i) { return r.slice().concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var piv = c; for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
      if (Math.abs(M[c][c]) < 1e-12) continue;
      for (r = 0; r < n; r++) if (r !== c) {
        var f = M[r][c] / M[c][c];
        for (var k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map(function (r, i) { return Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]; });
  }
  // X rows already standardized (no intercept column); returns [b0, b...].
  function fitLogit(X, y, lambda) {
    var n = X.length, d = X.length ? X[0].length : 0, w = new Array(d + 1).fill(0);
    var ybar = y.reduce(function (s, v) { return s + v; }, 0) / n;
    ybar = Math.min(0.99, Math.max(0.01, ybar)); w[0] = Math.log(ybar / (1 - ybar));
    for (var it = 0; it < 25; it++) {
      var H = []; for (var a = 0; a <= d; a++) H.push(new Array(d + 1).fill(0));
      var g = new Array(d + 1).fill(0);
      for (var i = 0; i < n; i++) {
        var z = w[0]; for (var j = 0; j < d; j++) z += w[j + 1] * X[i][j];
        var p = sigmoid(z), wt = Math.max(p * (1 - p), 1e-6), e = y[i] - p;
        g[0] += e; H[0][0] += wt;
        for (j = 0; j < d; j++) {
          var xj = X[i][j]; g[j + 1] += e * xj; H[0][j + 1] += wt * xj;
          for (var k = j; k < d; k++) H[j + 1][k + 1] += wt * xj * X[i][k];
        }
      }
      for (j = 1; j <= d; j++) { g[j] -= lambda * w[j]; H[j][j] += lambda; for (k = 0; k < j; k++) H[j][k] = H[k][j]; }
      var step = solve(H, g), mx = 0;
      for (j = 0; j <= d; j++) { w[j] += step[j]; mx = Math.max(mx, Math.abs(step[j])); }
      if (mx < 1e-7) break;
    }
    return w;
  }
  function featList(groups) { var f = []; groups.forEach(function (g) { f = f.concat(FEATS[g]); }); return f; }
  // Standardize with training stats; missing → 0 (the training average).
  function stats(rows, feats) {
    return feats.map(function (k) {
      var v = rows.map(function (r) { return r.f[k]; }).filter(isNum);
      if (v.length < 24) return { mu: 0, sd: 0 };
      var mu = v.reduce(function (s, x) { return s + x; }, 0) / v.length;
      var sd = Math.sqrt(v.reduce(function (s, x) { return s + (x - mu) * (x - mu); }, 0) / v.length);
      return { mu: mu, sd: sd };
    });
  }
  function zrow(r, feats, st) {
    return feats.map(function (k, j) { var x = r.f[k]; return isNum(x) && st[j].sd > 0 ? Math.max(-5, Math.min(5, (x - st[j].mu) / st[j].sd)) : 0; });
  }
  function fitOn(rows, groups, target, lambda) {
    var feats = featList(groups), st = stats(rows, feats);
    var X = rows.map(function (r) { return zrow(r, feats, st); }), y = rows.map(function (r) { return r.t[target]; });
    return { feats: feats, st: st, w: fitLogit(X, y, lambda) };
  }
  function predict(model, r) {
    var z = model.w[0], x = zrow(r, model.feats, model.st);
    for (var j = 0; j < x.length; j++) z += model.w[j + 1] * x[j];
    return sigmoid(z);
  }

  // Walk-forward: refit every `step` months on rows whose outcome was known.
  function walk(rows, groups, T, from, to, opts) {
    var step = opts.step || 12, lambda = opts.lambda || 3, minTrain = opts.minTrain || 120;
    var idx = {}; rows.forEach(function (r, i) { idx[r.m] = i; });
    var out = [];
    for (var s = from; s <= to; s = addM(s, step)) {
      var si = idx[s]; if (si === undefined) continue;
      var train = rows.slice(0, Math.max(0, si - T.h)).filter(function (r) { return r.t[T.id] !== null && r.m >= (opts.trainFrom || '0000'); });
      if (train.length < minTrain) continue;
      var base = train.reduce(function (a, r) { return a + r.t[T.id]; }, 0) / train.length;
      var model = groups.length ? fitOn(train, groups, T.id, lambda) : null;
      for (var k = 0; k < step; k++) {
        var r = rows[si + k]; if (!r || r.m > to) break;
        if (r.t[T.id] === null) continue;
        out.push({ m: r.m, y: r.t[T.id], p: model ? predict(model, r) : base, base: base });
      }
    }
    return out;
  }
  function score(preds) {
    if (!preds.length) return null;
    var b = 0, bb = 0, hit = 0, hitB = 0;
    preds.forEach(function (x) {
      b += (x.p - x.y) * (x.p - x.y); bb += (x.base - x.y) * (x.base - x.y);
      hit += ((x.p >= 0.5 ? 1 : 0) === x.y) ? 1 : 0; hitB += ((x.base >= 0.5 ? 1 : 0) === x.y) ? 1 : 0;
    });
    var n = preds.length;
    return { n: n, brier: b / n, brierBase: bb / n, skill: 1 - b / bb, acc: hit / n, accBase: hitB / n, rate: preds.reduce(function (s, x) { return s + x.y; }, 0) / n };
  }
  function calib(preds) {
    var bins = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.01]];
    return bins.map(function (b) {
      var s = preds.filter(function (x) { return x.p >= b[0] && x.p < b[1]; });
      return { from: b[0], to: Math.min(1, b[1]), n: s.length,
        predicted: s.length ? s.reduce(function (a, x) { return a + x.p; }, 0) / s.length : null,
        happened: s.length ? s.reduce(function (a, x) { return a + x.y; }, 0) / s.length : null };
    }).filter(function (b) { return b.n > 0; });
  }
  // Share of a group's values present during the selection window.
  function coverage(rows, g, from, to) {
    var r = rows.filter(function (x) { return x.m >= from && x.m <= to; });
    var feats = FEATS[g], have = 0, tot = 0;
    r.forEach(function (x) { feats.forEach(function (k) { tot++; if (isNum(x.f[k])) have++; }); });
    return tot ? have / tot : 0;
  }

  function build(series, opts) {
    opts = opts || {};
    var rows = buildTable(series, opts).filter(function (r) { return r.m >= (opts.start || '1955-01'); });
    if (rows.length < 400) return { error: 'Not enough S&P 500 history to build the model.' };
    var SEL = opts.selection || ['1975-01', '1999-12'], last = rows[rows.length - 1].m;
    var TEST = [opts.testFrom || '2000-01', last];
    var cov = {}, testable = [];
    GROUPS.forEach(function (g) {
      cov[g.id] = { selection: coverage(rows, g.id, SEL[0], SEL[1]), now: coverage(rows.slice(-1), g.id, last, last) };
      if (cov[g.id].selection >= 0.5 && cov[g.id].now > 0) testable.push(g.id);
    });
    var results = {};
    TARGETS.forEach(function (T) {
      if (rows.filter(function (r) { return r.t[T.id] !== null; }).length < 300) return;
      var wo = { step: opts.step || 12, lambda: opts.lambda || 3 };
      var chosen = [], cur = score(walk(rows, [], T, SEL[0], SEL[1], wo)), trail = [];
      var baseSel = cur;
      for (var round = 0; round < (opts.maxGroups || 4); round++) {
        var best = null;
        testable.forEach(function (g) {
          if (chosen.indexOf(g) >= 0) return;
          var s = score(walk(rows, chosen.concat([g]), T, SEL[0], SEL[1], wo));
          if (s && (!best || s.brier < best.s.brier)) best = { g: g, s: s };
        });
        if (!best || best.s.brier > cur.brier * (1 - (opts.minGain || 0.015))) break;
        chosen.push(best.g); trail.push({ g: best.g, skill: best.s.skill }); cur = best.s;
      }
      // Held-out test, 2000 → today.
      var testPreds = walk(rows, chosen, T, TEST[0], TEST[1], wo);
      var test = score(testPreds);
      // Each testable group on its own (diagnostic), on the selection window.
      var solo = {};
      testable.forEach(function (g) { var s = score(walk(rows, [g], T, SEL[0], SEL[1], wo)); solo[g] = s ? s.skill : null; });
      // Final model on everything known; prediction for the latest month.
      var known = rows.filter(function (r) { return r.t[T.id] !== null; });
      var base = known.reduce(function (a, r) { return a + r.t[T.id]; }, 0) / known.length;
      var now = rows[rows.length - 1], p = base, drivers = [];
      if (chosen.length) {
        var model = fitOn(known, chosen, T.id, wo.lambda);
        p = predict(model, now);
        drivers = chosen.map(function (g) {
          var feats = FEATS[g], m2 = { feats: model.feats, st: model.st, w: model.w.slice() };
          model.feats.forEach(function (k, j) { if (feats.indexOf(k) >= 0) m2.w[j + 1] = 0; });
          return { group: g, effect: p - predict(m2, now) };
        }).sort(function (a, b) { return Math.abs(b.effect) - Math.abs(a.effect); });
      }
      var useful = !!(test && chosen.length && test.skill > 0);
      results[T.id] = { q: T.q, horizon: T.h, chosen: chosen, trail: trail, selection: cur, selectionBase: baseSel, test: test, solo: solo,
        calibration: calib(testPreds), base: base, p: useful ? p : base, modelP: p, useful: useful, drivers: useful ? drivers : [] };
    });
    var now = rows[rows.length - 1];
    var inputs = {};
    Object.keys(now.f).forEach(function (k) { inputs[k] = isNum(now.f[k]) ? now.f[k] : null; });
    return { built: new Date().toISOString(), asOf: last, spx: now.p, months: rows.length, from: rows[0].m,
      selection: SEL, test: TEST, groups: GROUPS, coverage: cov, testable: testable, results: results, inputs: inputs };
  }

  // Same market-trend rules on other countries' indexes (a check that the
  // trend signal isn't a US-only accident). series: { name: [[date, close]] }.
  function globalCheck(markets) {
    var out = [];
    Object.keys(markets || {}).forEach(function (name) {
      var rows = buildTable({ SPX: markets[name] }).filter(function (r) { return isNum(r.f.trend10) && isNum(r.f.vol3); });
      if (rows.length < 240) return;
      var from = rows[Math.min(rows.length - 1, 180)].m, to = rows[rows.length - 1].m;
      var res = { name: name, from: rows[0].m, months: rows.length };
      [{ id: 'up12', h: 12 }, { id: 'drop10', h: 3 }].forEach(function (T) {
        var s = score(walk(rows, ['trend'], T, from, to, { step: 12, lambda: 3, minTrain: 150 }));
        res[T.id] = s ? { skill: s.skill, n: s.n, acc: s.acc, accBase: s.accBase } : null;
      });
      out.push(res);
    });
    return out;
  }

  return { build: build, globalCheck: globalCheck, buildTable: buildTable, GROUPS: GROUPS, FRED: FRED, TARGETS: TARGETS,
    _fitLogit: fitLogit, _walk: walk, _score: score };
});
