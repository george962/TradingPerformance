/* Portfolio (monthly account returns) — data + metrics. Pure JS, no deps.
 * Imports an optional monthly-returns sheet (CSV) directly in the browser:
 * per account a Month column followed by a Return column, with a header row
 * naming S&P 500 / Roth / Investment / 401k. See docs/METHODS.md.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Portfolio = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ACCOUNTS = [
    { id: 'roth', label: 'Roth IRA', type: 'Roth IRA' },
    { id: 'invest', label: 'Investment', type: 'Brokerage' },
    { id: 'roth401k', label: 'Roth 401k', type: 'Roth 401k' }
  ];
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function csvRows(text) {
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  // "Mar 2022", "March 2022", "3/2022", "2022-03" -> "Mar 2022" (or null).
  function normMonth(s) {
    s = String(s || '').trim();
    var m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/);
    if (m) {
      var k = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
      return k < 0 ? null : cap(MONTHS[k]) + ' ' + m[2];
    }
    m = s.match(/^(\d{1,2})\/(?:\d{1,2}\/)?(\d{4})$/) || null;
    if (m) return cap(MONTHS[parseInt(m[1], 10) - 1] || '') + ' ' + m[2];
    m = s.match(/^(\d{4})-(\d{1,2})/);
    if (m) return cap(MONTHS[parseInt(m[2], 10) - 1] || '') + ' ' + m[1];
    return null;
  }
  function cap(x) { return x ? x.charAt(0).toUpperCase() + x.slice(1) : x; }
  function monthKey(m) {
    var p = m.split(' ');
    return parseInt(p[1], 10) * 100 + MONTHS.indexOf(p[0].toLowerCase()) + 1;
  }
  // "4.84%" -> 4.84; "-5.09%" -> -5.09; "(1.2%)" -> -1.2; "" -> null.
  function parsePct(v) {
    var s = String(v == null ? '' : v).trim().replace(/,/g, '');
    if (!s || s === '-' || s === '—' || /^n\/?a$/i.test(s)) return null;
    var neg = /^\(.*\)$/.test(s);
    s = s.replace(/[()%\s]/g, '');
    var x = parseFloat(s);
    if (isNaN(x)) return null;
    return neg ? -Math.abs(x) : x;
  }

  // Is this CSV a portfolio sheet (vs a Fidelity history export)?
  function looksLikeSheet(text) {
    var head = text.slice(0, 4000).toLowerCase();
    return head.indexOf('run date') === -1 && (head.indexOf('s&p') !== -1 || head.indexOf('roth') !== -1);
  }

  function parseSheet(text) {
    var rows = csvRows(text);
    var hi = -1;
    for (var i = 0; i < rows.length && i < 20; i++) {
      var low = rows[i].map(function (c) { return String(c).toLowerCase(); });
      if (low.some(function (c) { return c.indexOf('s&p') !== -1 || c.indexOf('roth') !== -1 || c.indexOf('invest') !== -1; })) { hi = i; break; }
    }
    if (hi === -1) return { error: 'No header row naming S&P 500 / Roth / Investment / 401k was found.' };
    var hdr = rows[hi].map(function (c) { return String(c).toLowerCase(); });
    function col(test) { for (var j = 0; j < hdr.length; j++) if (test(hdr[j])) return j; return -1; }
    var cols = {
      sp: col(function (h) { return h.indexOf('s&p') !== -1; }),
      roth: col(function (h) { return h.indexOf('roth') !== -1 && h.indexOf('401') === -1; }),
      invest: col(function (h) { return h.indexOf('invest') !== -1; }),
      roth401k: col(function (h) { return h.indexOf('401') !== -1; })
    };
    // The label may sit over the month column (month, return) or over the
    // return column (month to its left) — use whichever reads more rows.
    function read(mc, rc) {
      var out = {};
      if (mc < 0) return out;
      for (var r = hi + 1; r < rows.length; r++) {
        var m = normMonth(rows[r][mc]);
        var v = parsePct(rows[r][rc]);
        if (m && v !== null) out[m] = v;
      }
      return out;
    }
    function series(c) {
      if (c < 0) return [];
      var a = read(c, c + 1), b = read(c - 1, c);
      var out = Object.keys(b).length > Object.keys(a).length ? b : a;
      return Object.keys(out).sort(function (a, b) { return monthKey(a) - monthKey(b); })
        .map(function (m) { return [m, out[m]]; });
    }
    var res = { sp: series(cols.sp), accounts: {} };
    ACCOUNTS.forEach(function (a) { res.accounts[a.id] = series(cols[a.id]); });
    var n = ACCOUNTS.reduce(function (s, a) { return s + res.accounts[a.id].length; }, 0);
    if (!n) return { error: 'The sheet had a header row but no month / return rows under it.' };
    return res;
  }

  // Metrics for one account. Both lines start at 1.0 before the first month
  // and compound the SAME months, so the comparison is like for like.
  function metrics(rows, spRows) {
    if (!rows || !rows.length) return null;
    var spMap = {};
    (spRows || []).forEach(function (r) { spMap[r[0]] = r[1]; });
    var nav = 1, bnav = 1, peak = 1, peakM = null, dd = 0, ddFrom = null, ddTo = null;
    var lowNav = Infinity, lowM = null, runFrom = null, bestRun = 0, bestRunFrom = null, bestRunTo = null;
    var minSoFar = 1, minSoFarM = null;
    var wins = 0, beats = 0, hasSp = 0, best = -Infinity, bestM = '', worst = Infinity, worstM = '';
    var data = rows.map(function (r) {
      var m = r[0], p = r[1], b = spMap[m];
      nav *= 1 + p / 100;
      if (b !== undefined) { bnav *= 1 + b / 100; hasSp++; if (p > b) beats++; }
      if (p > 0) wins++;
      if (p > best) { best = p; bestM = m; }
      if (p < worst) { worst = p; worstM = m; }
      if (nav > peak) { peak = nav; peakM = m; }
      var draw = nav / peak - 1;
      if (draw < dd) { dd = draw; ddFrom = peakM; ddTo = m; }
      // best run: largest rise from the lowest point before it
      var run = nav / minSoFar - 1;
      if (run > bestRun) { bestRun = run; bestRunFrom = minSoFarM; bestRunTo = m; }
      if (nav < minSoFar) { minSoFar = nav; minSoFarM = m; }
      if (nav < lowNav) { lowNav = nav; lowM = m; }
      return { m: m, p: p, b: b === undefined ? null : b, nav: nav, bnav: bnav };
    });
    var n = rows.length;
    var total = nav - 1, spTotal = bnav - 1;
    return {
      data: data, months: n, from: rows[0][0], to: rows[n - 1][0],
      total: total * 100, spTotal: spTotal * 100, vsSp: (total - spTotal) * 100,
      annual: (Math.pow(nav, 12 / n) - 1) * 100, spAnnual: (Math.pow(bnav, 12 / n) - 1) * 100,
      nav: nav, winRate: wins / n * 100, wins: wins,
      beatMonths: beats, spMonths: hasSp,
      best: best, bestM: bestM, worst: worst, worstM: worstM,
      peak: peak, peakM: peakM || rows[0][0], low: lowNav, lowM: lowM,
      maxDrawdown: dd * 100, ddFrom: ddFrom || 'start', ddTo: ddTo,
      bestRun: bestRun * 100, bestRunFrom: bestRunFrom || ('before ' + rows[0][0]), bestRunTo: bestRunTo
    };
  }

  return { ACCOUNTS: ACCOUNTS, parseSheet: parseSheet, looksLikeSheet: looksLikeSheet,
    metrics: metrics, normMonth: normMonth, parsePct: parsePct };
});
