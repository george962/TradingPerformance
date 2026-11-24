// Market-regime backtest (S&P 500, monthly 1960 → today) → regime-table.json.
//
//   python3 tools/fetch-regime-data.py      (downloads tools/regime-data/: FRED + S&P 500)
//   node tools/regime-backtest.js [dataDir] (writes regime-table.json)
//
// Regime rules are fixed in economy.js (marketRegime), the same code the app
// runs — nothing is tuned here. For every month we record the regime (using
// only data published by then) and what the S&P did next. Two kinds of
// numbers come out:
//  1. A WALK-FORWARD test: each month is forecast using only months whose
//     outcome was already known at that time; compared with the plain
//     "market usually goes up" base rate computed the same way.
//  2. The regime table written to regime-table.json (used by the app).
'use strict';
const fs = require('fs'), path = require('path');
const EC = require(path.join(__dirname, '..', 'economy.js'));
const DATA = path.resolve(process.argv[2] || path.join(__dirname, 'regime-data'));
const L = f => JSON.parse(fs.readFileSync(path.join(DATA, f + '.json')));
const R = {
  marketRegime: EC.marketRegime,
  isoAddMonths(iso, months) {
    const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 + months, +iso.slice(8, 10)));
    return d.toISOString().slice(0, 10);
  }
};
const spx = L('SPX'), macro = { SAHMREALTIME: L('SAHMREALTIME'), GS10: L('GS10'), TB3MS: L('TB3MS'), BAA: L('BAA') };
const usrec = {}; L('USREC').forEach(r => { usrec[r[0].slice(0, 7)] = r[1]; });
const dates = spx.map(r => r[0]);
const at = d => { let lo = 0, hi = dates.length - 1, b = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] >= d) { b = m; hi = m - 1; } else lo = m + 1; } return b; };
const H = [1, 3, 6, 12];

// ---- monthly snapshots
const snaps = [];
for (let y = 1960; y <= new Date().getUTCFullYear(); y++) for (let m = 1; m <= 12; m++) {
  const d0 = `${y}-${String(m).padStart(2, '0')}-01`; if (d0 > dates[dates.length - 1]) break;
  const i = at(d0); if (i < 260) continue;
  const asOf = dates[i], P = spx[i][1];
  const reg = R.marketRegime(spx.slice(0, i + 1), macro, asOf);
  const s = { asOf, key: reg.key, trendDown: reg.trendDown, warn: reg.warnings.length > 0, fwd: {} };
  for (const h of H) {
    const j = at(R.isoAddMonths(asOf, h)); if (j < 0) continue;
    let mn = Infinity; for (let k = i + 1; k <= j; k++) mn = Math.min(mn, spx[k][1]);
    s.fwd[h] = { ret: spx[j][1] / P - 1, drop10: mn / P - 1 <= -0.10, end: dates[j] };
  }
  // recession during the next 12 months (official NBER dates — known only afterwards; used for scenarios)
  let rec = false; for (let k = 0; k <= 12; k++) { const dd = R.isoAddMonths(asOf.slice(0, 7) + '-01', k).slice(0, 7); if (usrec[dd] === 1) rec = true; }
  s.rec12 = rec; s.recKnown = R.isoAddMonths(asOf, 13) <= dates[dates.length - 1];
  snaps.push(s);
}
console.log(`months: ${snaps.length} (${snaps[0].asOf} → ${snaps[snaps.length - 1].asOf})`);

// ---- statistics for a set of snapshots
const q = (a, p) => { const v = a.slice().sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))] : NaN; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
function stats(list) {
  const o = { n: list.length, h: {} };
  for (const h of H) {
    const v = list.filter(s => s.fwd[h]); if (!v.length) continue;
    const r = v.map(s => s.fwd[h].ret);
    o.h[h] = { n: v.length, mean: mean(r), median: q(r, 0.5), p10: q(r, 0.1), p90: q(r, 0.9), pUp: mean(r.map(x => x > 0 ? 1 : 0)), pDrop10: mean(v.map(s => s.fwd[h].drop10 ? 1 : 0)) };
  }
  const k = list.filter(s => s.recKnown && s.fwd[12]);
  if (k.length) {
    const yes = k.filter(s => s.rec12), no = k.filter(s => !s.rec12);
    o.pRec12 = yes.length / k.length;
    o.noRec = no.length ? { n: no.length, median12: q(no.map(s => s.fwd[12].ret), 0.5), p10: q(no.map(s => s.fwd[12].ret), 0.1), pDrop10: mean(no.map(s => s.fwd[12].drop10 ? 1 : 0)) } : null;
    o.rec = yes.length ? { n: yes.length, median12: q(yes.map(s => s.fwd[12].ret), 0.5), p10: q(yes.map(s => s.fwd[12].ret), 0.1), pDrop10: mean(yes.map(s => s.fwd[12].drop10 ? 1 : 0)) } : null;
  }
  return o;
}
const KEYS = ['up-clear', 'up-warn', 'down-clear', 'down-warn'];
function table(list) {
  const t = { all: stats(list) }; KEYS.forEach(k => { t[k] = stats(list.filter(s => s.key === k)); });
  // Recession scenario: every downtrend month that was followed by a recession within 12 months.
  t.downRecession = stats(list.filter(s => s.trendDown && s.recKnown && s.rec12));
  return t;
}

// ---- 1. walk-forward: forecast each month from months whose outcome was already known
function known(asOf, h) { return snaps.filter(s => s.fwd[h] && s.fwd[h].end <= asOf); }
const res = {};
for (const h of [1, 3, 12]) {
  let bReg = 0, bAll = 0, n = 0, dReg = 0, dAll = 0, nd = 0; const byKey = {};
  for (const s of snaps) {
    if (s.asOf < '1975-01-01' || !s.fwd[h]) continue;
    const past = known(s.asOf, h); if (past.length < 120) continue;
    const pk = past.filter(x => x.key === s.key);
    const upAll = mean(past.map(x => x.fwd[h].ret > 0 ? 1 : 0));
    const upReg = pk.length >= 24 ? mean(pk.map(x => x.fwd[h].ret > 0 ? 1 : 0)) : upAll;   // fall back if too few
    const dAllP = mean(past.map(x => x.fwd[h].drop10 ? 1 : 0));
    const dRegP = pk.length >= 24 ? mean(pk.map(x => x.fwd[h].drop10 ? 1 : 0)) : dAllP;
    const y = s.fwd[h].ret > 0 ? 1 : 0, yd = s.fwd[h].drop10 ? 1 : 0;
    bReg += (upReg - y) ** 2; bAll += (upAll - y) ** 2; n++;
    dReg += (dRegP - yd) ** 2; dAll += (dAllP - yd) ** 2; nd++;
    const b = byKey[s.key] = byKey[s.key] || { n: 0, said: 0, up: 0, saidD: 0, d: 0 };
    b.n++; b.said += upReg; b.up += y; b.saidD += dRegP; b.d += yd;
  }
  res[h] = { n, brierRegime: bReg / n, brierBase: bAll / n, brierDropRegime: dReg / nd, brierDropBase: dAll / nd, byKey };
}
const pc = x => (x * 100).toFixed(0) + '%';
console.log('\n1) WALK-FORWARD (1975 → today): does knowing the regime improve the S&P forecast?');
console.log('   probability score, lower = better: "regime" uses only earlier months in the same regime; "base" uses all earlier months.');
for (const h of [1, 3, 12]) {
  const r = res[h];
  console.log(`   ${String(h).padStart(2)} mo (n=${r.n}): S&P higher — regime ${r.brierRegime.toFixed(4)} vs base ${r.brierBase.toFixed(4)} (${r.brierRegime < r.brierBase ? 'regime better' : 'base better'}) · another −10% drop — regime ${r.brierDropRegime.toFixed(4)} vs base ${r.brierDropBase.toFixed(4)} (${r.brierDropRegime < r.brierDropBase ? 'regime better' : 'base better'})`);
  KEYS.forEach(k => { const b = r.byKey[k]; if (b) console.log(`        ${k.padEnd(10)} n=${String(b.n).padStart(3)} · said higher ${pc(b.said / b.n)} → was ${pc(b.up / b.n)} · said −10% drop ${pc(b.saidD / b.n)} → was ${pc(b.d / b.n)}`); });
}

// ---- 2. regime table (all history to date) + per-year tables (only earlier years)
const full = table(snaps);
console.log('\n2) WHAT THE S&P DID NEXT, BY REGIME (1960 → today, all months):');
for (const k of ['all'].concat(KEYS)) {
  const t = full[k]; if (!t.h[12]) continue;
  console.log(`   ${k.padEnd(10)} months=${String(t.n).padStart(3)} | 3 mo: higher ${pc(t.h[3].pUp)}, median ${pc(t.h[3].median)}, another −10% drop ${pc(t.h[3].pDrop10)} | 12 mo: higher ${pc(t.h[12].pUp)}, median ${pc(t.h[12].median)}, bad year (10th pct) ${pc(t.h[12].p10)}, −10% drop at some point ${pc(t.h[12].pDrop10)} | recession within 12 mo ${pc(t.pRec12)}` +
    (t.noRec && t.rec ? ` | if no recession: median ${pc(t.noRec.median12)}; if recession: median ${pc(t.rec.median12)} (n=${t.rec.n})` : ''));
}
// S&P selloffs of 7%+ from a record, split by whether a recession happened during them.
function selloffs() {
  const out = []; let peak = spx[0][1], pk = 0, i = 0;
  while (i < spx.length) {
    if (spx[i][1] > peak) { peak = spx[i][1]; pk = i; }
    if (spx[i][1] <= peak * 0.93) {
      let j = i, low = spx[i][1];
      while (j < spx.length && spx[j][1] < peak) { low = Math.min(low, spx[j][1]); j++; }
      if (j >= spx.length) break;            // the current, unfinished selloff
      let rec = false; for (let d = spx[pk][0].slice(0, 7); d <= spx[j][0].slice(0, 7); d = R.isoAddMonths(d + '-01', 1).slice(0, 7)) if (usrec[d] === 1) { rec = true; break; }
      out.push({ depth: low / peak - 1, rec, months: (j - pk) / 21 });
      peak = spx[j][1]; pk = j; i = j;
    }
    i++;
  }
  const med = a => q(a, 0.5);
  const r = out.filter(e => e.rec), n = out.filter(e => !e.rec);
  return { recession: { n: r.length, medianDepth: med(r.map(e => e.depth)), worst: Math.min(...r.map(e => e.depth)), medianMonths: med(r.map(e => e.months)) },
           noRecession: { n: n.length, medianDepth: med(n.map(e => e.depth)), worst: Math.min(...n.map(e => e.depth)), medianMonths: med(n.map(e => e.months)) } };
}
const SELLOFFS = selloffs();
console.log(`\nSelloffs of 7%+ since 1950: no recession n=${SELLOFFS.noRecession.n}, median depth ${pc(SELLOFFS.noRecession.medianDepth)}, ~${SELLOFFS.noRecession.medianMonths.toFixed(0)} months peak to new high; recession n=${SELLOFFS.recession.n}, median depth ${pc(SELLOFFS.recession.medianDepth)} (worst ${pc(SELLOFFS.recession.worst)}), ~${SELLOFFS.recession.medianMonths.toFixed(0)} months`);
const current = R.marketRegime(spx, macro, null);
const built = process.env.REGIME_BUILT || new Date().toISOString().slice(0, 10);
const out = { built, table: full, selloffs: SELLOFFS,
  walkForward: Object.fromEntries(Object.entries(res).map(([h, r]) => [h, { n: r.n, brierRegime: r.brierRegime, brierBase: r.brierBase, brierDropRegime: r.brierDropRegime, brierDropBase: r.brierDropBase }])) };
const dest = path.join(__dirname, '..', 'regime-table.json');
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`\nToday: ${current.key} (S&P ${current.spx.toFixed(0)} vs 200-day ${current.sma200.toFixed(0)}; ${current.warnings.join(', ') || 'no warnings'})`);
console.log('Wrote ' + path.relative(process.cwd(), dest));
