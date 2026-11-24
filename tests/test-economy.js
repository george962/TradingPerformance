/* Economy outlook + move-together tests — plain node. Usage: node tests/test-economy.js */
'use strict';
const fs = require('fs'), path = require('path');
const EC = require('../economy.js');
const App = require('../app.js');
const rt = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'regime-table.json'), 'utf8'));
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
// 260 trading days rising, then a 12% fall: below the 200-day average.
const rows = []; let p = 100;
for (let i = 0; i < 300; i++) {
  const d = new Date(Date.UTC(2025, 9, 1) + i * 864e5).toISOString().slice(0, 10);
  p *= i < 260 ? 1.001 : 0.9968; rows.push([d, p]);
}
const asOf = rows[rows.length - 1][0];
const months = (vals) => vals.map((v, i) => [new Date(Date.UTC(2024, i, 1)).toISOString().slice(0, 10), v]);
const calm = { SAHMREALTIME: months(Array(24).fill(0.2)), GS10: months(Array(24).fill(4.2)), TB3MS: months(Array(24).fill(3.8)), BAA: months(Array(24).fill(5.9)) };
const r1 = EC.marketRegime(rows, calm);
check('downtrend detected below the 200-day average', r1.trendDown && r1.vsSma < 0, r1.vsSma);
check('no warnings with calm economy data', r1.key === 'down-clear' && r1.haveMacro);
const bad = { SAHMREALTIME: months(Array(23).fill(0.2).concat([0.6])), GS10: calm.GS10, TB3MS: months(Array(24).fill(4.5)), BAA: calm.BAA };
const r2 = EC.marketRegime(rows, bad);
check('Sahm ≥ 0.5 and an inverted curve switch warnings on', r2.key === 'down-warn' && r2.checks.sahm.on && r2.checks.curve.on, JSON.stringify(r2.warnings));
check('economy data only counts once published (~5 weeks)', EC.monthlyAsOf([['2026-11-01', 1]], '2026-11-20').length === 0 && EC.monthlyAsOf([['2026-10-01', 1]], '2026-11-20').length === 1);
const o = EC.outlook(r2, rt);
check('outlook reads the backtested table for the situation', o && o.horizons.length === 4 && Math.abs(o.horizons[1].pUp - rt.table['down-warn'].h['3'].pUp) < 1e-12 && o.pRec12 === rt.table['down-warn'].pRec12);
check('downtrend + warnings is worse than average (backtest)', rt.table['down-warn'].h['3'].pDrop10 > rt.table.all.h['3'].pDrop10 * 2);
const r3 = EC.marketRegime(rows, null);
check('without economy data: not classified as clear', !r3.haveMacro);

// Move together
const hist = {}, base = [];
let a = 100, b = 50, c = 30;
for (let i = 0; i < 260; i++) {
  const d = new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10);
  const m = Math.sin(i * 1.7) * 0.02, n = Math.cos(i * 2.3) * 0.02;
  a *= 1 + m; b *= 1 + m * 1.5 + n * 0.1; c *= 1 + n;
  base.push(d); (hist.A = hist.A || []).push([d, a]); (hist.B = hist.B || []).push([d, b]); (hist.C = hist.C || []).push([d, c]);
}
const t = EC.together(hist, ['A', 'B', 'C'], { A: 0.5, B: 0.3, C: 0.2 });
check('A and B grouped as one bet, C separate', t.groups.length === 1 && t.groups[0].members.join() === 'A,B' && Math.abs(t.groups[0].weight - 0.8) < 1e-9, JSON.stringify(t.groups));
check('fear & greed labels', EC.fearGreedLabel(10) === 'Extreme fear' && EC.fearGreedLabel(50) === 'Neutral' && EC.fearGreedLabel(80) === 'Extreme greed');

// Rendered outlook
const html = App.buildOutlook({ indexRows: rows, regimeTable: rt, market: { macro: bad } });
check('outlook card: situation, lights, odds table, recession scenarios, honesty note',
  html.includes('Market downtrend with recession warnings') && html.includes('Unemployment (Sahm rule)') && html.includes('Chance of a further −10%') &&
  html.includes('If a recession comes') && html.includes('not a forecast'));
const htmlClear = App.buildOutlook({ indexRows: rows, regimeTable: rt, market: { macro: calm } });
check('plain answer: downtrend without warnings leans up, and says what would flip it', htmlClear.includes('Leaning up') && htmlClear.includes('What would change this'));
check('plain answer: downtrend with warnings leans down', html.includes('Leaning down'));
const html2 = App.buildOutlook({ indexRows: rows, regimeTable: rt, market: {} });
check('missing economy data shows both cases', html2.includes('economy data not loaded') && html2.includes('Downtrend, no warnings') && html2.includes('Downtrend + warnings'));
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
