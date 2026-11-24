// Outlook model: logistic fit, walk-forward, selection on synthetic data, real-data smoke test.
const OM = require('../outlook-model.js'), assert = require('assert'), fs = require('fs'), path = require('path');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok', name); }
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }
// Synthetic world: monthly GS10/TB3MS, daily SPX whose next-3-month drift depends on the curve when informative.
function world(informative, seed) {
  const r = rng(seed), S = { SPX: [], GS10: [], TB3MS: [], BAA: [], USREC: [] };
  let px = 100, curve = 1, d = new Date(Date.UTC(1950, 0, 2));
  for (let y = 1950; y <= 2025; y++) for (let m = 0; m < 12; m++) {
    const key = y + '-' + String(m + 1).padStart(2, '0') + '-01';
    curve = 0.93 * curve + 0.35 * gauss(r);
    S.GS10.push([key, 5 + curve]); S.TB3MS.push([key, 5]); S.BAA.push([key, 6.5 + 0.3 * gauss(r)]); S.USREC.push([key, 0]);
    // the curve published last month (the model sees a 1-month lag) drives the next months' drift
    const drift = informative ? 0.012 * Math.sign(curve) : 0.004;
    for (let k = 0; k < 21; k++) { px *= Math.exp(drift / 21 + 0.035 / Math.sqrt(21) * gauss(r)); S.SPX.push([y + '-' + String(m + 1).padStart(2, '0') + '-' + String(k + 1).padStart(2, '0'), px]); }
  }
  return S;
}
ok('logistic recovers a known slope', () => {
  const r = rng(3), X = [], y = [];
  for (let i = 0; i < 4000; i++) { const x = gauss(r); X.push([x]); y.push(r() < 1 / (1 + Math.exp(-(0.5 + 1.5 * x))) ? 1 : 0); }
  const w = OM._fitLogit(X, y, 0.01);
  assert(Math.abs(w[0] - 0.5) < 0.15 && Math.abs(w[1] - 1.5) < 0.2, w);
});
ok('feature table uses no future data', () => {
  const S = world(true, 5), rows = OM.buildTable(S), full = rows.find(r => r.m === '2000-06');
  const cut = {}; Object.keys(S).forEach(k => cut[k] = S[k].filter(x => x[0] < '2000-07'));
  const part = OM.buildTable(cut).find(r => r.m === '2000-06');
  Object.keys(full.f).forEach(k => assert(Object.is(full.f[k], part.f[k]) || Math.abs(full.f[k] - part.f[k]) < 1e-12, k));
  assert.strictEqual(OM.buildTable(cut).slice(-1)[0].t.up3, null, 'last month outcome unknown');
});
ok('a real signal is picked and beats the average out of sample', () => {
  const res = OM.build(world(true, 11)), u = res.results.up3;
  assert(u.chosen.includes('curve'), u.chosen);
  assert(u.useful && u.test.skill > 0.03, u.test);
});
ok('pure noise: nothing kept, odds = long-run average', () => {
  const res = OM.build(world(false, 13));
  Object.values(res.results).forEach(x => { if (x.useful) assert(x.test.skill < 0.03); else assert.strictEqual(x.p, x.base); });
  assert(!res.results.up3.useful || res.results.up3.chosen.length <= 1);
});
ok('missing groups are reported, not tested', () => {
  const res = OM.build(world(true, 17));
  ['policy', 'global', 'sentiment'].forEach(g => assert(!res.testable.includes(g) && res.coverage[g].now === 0));
});
ok('global check runs on other markets', () => {
  const g = OM.globalCheck({ Test: world(true, 19).SPX });
  assert.strictEqual(g.length, 1); assert(g[0].up12 && typeof g[0].up12.skill === 'number');
});
const real = '/home/claude/realdata';
if (fs.existsSync(path.join(real, 'SPX.json'))) ok('real history (1950–2026) builds', () => {
  const S = {}; ['SPX', 'SAHMREALTIME', 'GS10', 'TB3MS', 'BAA', 'USREC', 'PE10'].forEach(id => S[id] = JSON.parse(fs.readFileSync(path.join(real, id + '.json'))));
  const res = OM.build(S); assert(res.months > 800 && Object.keys(res.results).length === 4);
  Object.values(res.results).forEach(x => assert(x.p > 0 && x.p < 1));
});
console.log(n + ' outlook-model tests passed');
