#!/usr/bin/env node
/* Builds sample/sample-data.json — the "Try sample data" set.
 *
 * Everything in it is MADE UP: the account, the tickers (NOVA, ORBT, LUMA,
 * PEAK, LEV3, TERRA, IDXF), every trade, and every price — including the
 * "S&P 500" line, which is a random walk with stock-market-like drift and
 * volatility. No real market data is used, so it can be shipped and
 * screenshotted freely, and it works offline.
 *
 * Deterministic: the same seed always gives the same file.
 * Usage: node tools/make-sample.js   (writes sample/sample-data.json)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const START = '2022-01-03', END = '2026-11-20', SEED = 20260101;
const ACCOUNT = 'SAMPLE01';

// ---------------------------------------------------------------- random
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
function normal() {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------- calendar
function weekdays(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 864e5) {
    const d = new Date(t), wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
const DAYS = weekdays(START, END);
function onOrAfter(d) { return DAYS.find(x => x >= d); }

// ---------------------------------------------------------------- prices
// Market: total-return index with ~9%/yr drift and ~17% volatility; the
// price index is the same minus a 1.5%/yr dividend yield.
const mkt = [], trIdx = [], pxIdx = [];
let tr = 9000, px = 4500;
DAYS.forEach((d, i) => {
  const r = i === 0 ? 0 : 0.09 / 252 + 0.17 / Math.sqrt(252) * normal();
  mkt.push(r);
  tr *= Math.exp(r); px *= Math.exp(r - 0.015 / 252);
  trIdx.push([d, +tr.toFixed(2)]); pxIdx.push([d, +px.toFixed(2)]);
});
// Stocks: beta × market + their own drift and noise.
const STOCKS = {
  NOVA: { start: 120, beta: 1.35, drift: 0.12, vol: 0.32, desc: 'NOVA DYNAMICS INC (SAMPLE)', type: 'Stock' },
  ORBT: { start: 64, beta: 1.10, drift: -0.14, vol: 0.30, desc: 'ORBIT LOGISTICS CORP (SAMPLE)', type: 'Stock' },
  LUMA: { start: 210, beta: 0.90, drift: 0.04, vol: 0.22, desc: 'LUMA HEALTH GROUP (SAMPLE)', type: 'Stock' },
  PEAK: { start: 48, beta: 0.65, drift: -0.01, vol: 0.16, desc: 'PEAK UTILITIES CO (SAMPLE)', type: 'Stock', divYield: 0.04 },
  LEV3: { start: 30, beta: 2.8, drift: -0.05, vol: 0.18, desc: 'TRIPLE GROWTH ETF (SAMPLE)', type: 'ETF' },
  TERRA: { start: 85, beta: 1.0, drift: 0.10, vol: 0.28, desc: 'TERRA MATERIALS INC (SAMPLE)', type: 'Stock' },
  IDXF: { start: 150, index: true, desc: 'SAMPLE 500 INDEX FUND (SAMPLE)', type: 'Mutual Fund', divYield: 0.015 }
};
const close = {};
Object.keys(STOCKS).forEach(sym => {
  const s = STOCKS[sym], rows = {};
  let p = s.start;
  DAYS.forEach((d, i) => {
    if (i) p *= s.index ? pxIdx[i][1] / pxIdx[i - 1][1]
      : Math.exp(s.beta * mkt[i] + (s.drift - (s.divYield || 0)) / 252 + s.vol / Math.sqrt(252) * normal());
    rows[d] = +p.toFixed(2);
  });
  close[sym] = rows;
});

// ---------------------------------------------------------------- trades
const rows = [];   // { date, action, symbol, desc, type, qty, price, amount }
const shares = {}; let cash = 0;
function r2(x) { return Math.round(x * 100) / 100; }
function r3(x) { return Math.round(x * 1000) / 1000; }
function push(date, action, symbol, qty, price, amount) {
  const s = STOCKS[symbol] || {};
  cash = r2(cash + amount);
  if (cash < -0.005) throw new Error('cash went negative on ' + date + ' (' + action + ' ' + symbol + ')');
  rows.push({ date, action, symbol: symbol || '', desc: s.desc || 'Cash', type: s.type || '', qty, price, amount, bal: cash });
}
function deposit(d, amt) { push(onOrAfter(d), 'ELECTRONIC FUNDS TRANSFER RECEIVED (Cash)', '', 0, 0, amt); }
function withdraw(d, amt) { push(onOrAfter(d), 'ELECTRONIC FUNDS TRANSFER PAID (Cash)', '', 0, 0, -amt); }
function buy(d, sym, dollars, fractional) {
  d = onOrAfter(d);
  const p = close[sym][d], q = fractional ? r3(dollars / p) : Math.floor(dollars / p);
  shares[sym] = r3((shares[sym] || 0) + q);
  push(d, 'YOU BOUGHT ' + STOCKS[sym].desc + ' (' + sym + ') (Cash)', sym, q, p, -r2(q * p));
}
function sell(d, sym, part) {
  d = onOrAfter(d);
  const p = close[sym][d], q = part === 'all' ? shares[sym] : r3(Math.floor(shares[sym] * part));
  shares[sym] = r3(shares[sym] - q);
  push(d, 'YOU SOLD ' + STOCKS[sym].desc + ' (' + sym + ') (Cash)', sym, -q, p, r2(q * p));
}

deposit('2022-01-04', 12000);
buy('2022-01-05', 'IDXF', 4000, true); buy('2022-01-05', 'NOVA', 2600); buy('2022-01-06', 'ORBT', 2000);
deposit('2022-06-14', 3000); buy('2022-06-15', 'LUMA', 2800);
sell('2022-09-20', 'ORBT', 'all');
buy('2022-10-03', 'PEAK', 3000);
deposit('2023-01-03', 6000); buy('2023-01-04', 'IDXF', 3000, true); buy('2023-01-04', 'LEV3', 2500);
sell('2023-05-10', 'NOVA', 0.5);
buy('2023-07-12', 'NOVA', 1500); buy('2023-07-12', 'NOVA', 40, true);   // whole + fractional = one purchase
sell('2023-11-01', 'LEV3', 'all'); buy('2023-11-02', 'ORBT', 2000);
deposit('2024-01-02', 6000); buy('2024-01-03', 'IDXF', 4000, true);
deposit('2024-03-14', 8000); buy('2024-03-15', 'NOVA', 3000); buy('2024-03-15', 'LUMA', 3000);
sell('2024-08-05', 'LUMA', 0.5);
buy('2024-09-10', 'LEV3', 2200);
deposit('2025-01-02', 6000); sell('2025-02-20', 'NOVA', 0.4);
buy('2025-04-08', 'ORBT', 2500); buy('2025-04-08', 'IDXF', 2000, true);
sell('2025-06-02', 'PEAK', 'all');
buy('2025-09-15', 'TERRA', 3000);
deposit('2026-01-02', 6000); buy('2026-01-05', 'IDXF', 3000, true); buy('2026-01-05', 'TERRA', 2000);
sell('2026-03-03', 'LEV3', 'all');
buy('2026-05-12', 'NOVA', 2500);
withdraw('2026-08-20', 2000);
sell('2026-10-01', 'ORBT', 'all');

// Dividends: PEAK pays cash quarterly; IDXF's are reinvested; cash earns a
// little interest at year-end. Added in date order, then everything sorted.
function sharesOn(sym, d) {
  let q = 0;
  rows.forEach(r => { if (r.symbol === sym && r.date <= d && /YOU (BOUGHT|SOLD)|REINVESTMENT/.test(r.action)) q += r.qty; });
  return r3(q);
}
const income = [];
['03', '06', '09', '12'].forEach(m => {
  for (let y = 2022; y <= 2026; y++) {
    const d = onOrAfter(y + '-' + m + '-20');
    if (!d) continue;
    income.push({ d, sym: 'PEAK' }, { d, sym: 'IDXF' });
  }
});
for (let y = 2022; y <= 2025; y++) income.push({ d: onOrAfter(y + '-12-29'), sym: '' });
income.sort((a, b) => a.d < b.d ? -1 : 1);
// Re-run the ledger in date order so cash balances and share counts are right.
const trades = rows.splice(0);
cash = 0;
const events = trades.map(t => ({ d: t.date, t })).concat(income.map(x => ({ d: x.d, inc: x })))
  .sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : (a.inc ? -1 : 0) - (b.inc ? -1 : 0));
events.forEach(e => {
  if (e.t) { push(e.t.date, e.t.action, e.t.symbol, e.t.qty, e.t.price, e.t.amount); return; }
  const { d, sym } = e.inc;
  if (!sym) { const amt = r2(Math.max(0, cash) * 0.01); if (amt >= 0.01) push(d, 'INTEREST EARNED (Cash)', '', 0, 0, amt); return; }
  const q = sharesOn(sym, d);
  if (q <= 0) return;
  const amt = r2(q * close[sym][d] * STOCKS[sym].divYield / 4);
  if (amt < 0.01) return;
  push(d, 'DIVIDEND RECEIVED ' + STOCKS[sym].desc + ' (' + sym + ') (Cash)', sym, 0, 0, amt);
  if (sym === 'IDXF') {
    const rq = r3(amt / close[sym][d]);
    push(d, 'REINVESTMENT ' + STOCKS[sym].desc + ' (' + sym + ') (Cash)', sym, rq, close[sym][d], -amt);
  }
});

// ---------------------------------------------------------------- CSV files
function money(x) { return (x < 0 ? '-' : '') + '$' + Math.abs(x).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function q(s) { return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function mdY(d) { return d.slice(5, 7) + '/' + d.slice(8, 10) + '/' + d.slice(0, 4); }
const HEADER = 'Run Date,Action,Symbol,Security Description,Security Type,Quantity,Price ($),Commission ($),Fees ($),Accrued Interest ($),Amount ($),Cash Balance ($),Settlement Date';
const files = [];
for (let y = 2022; y <= 2026; y++) {
  const yr = rows.filter(r => r.date.startsWith(String(y))).reverse(); // Fidelity lists newest first
  const lines = ['', '', 'Brokerage', '', HEADER].concat(yr.map(r => [mdY(r.date), q(r.action), r.symbol, q(r.desc), r.type,
    r.qty ? String(r.qty) : '0', r.price ? money(r.price) : '', '', '', '', q(money(r.amount)), q(money(r.bal)), mdY(r.date)].join(',')));
  lines.push('', '"The data and information in this spreadsheet is sample data made up for demonstration."');
  files.push({ name: 'History_for_Account_' + ACCOUNT + '_' + y + '.csv', csv: lines.join('\n') + '\n' });
}

// ---------------------------------------------------------------- sheet
// A monthly-returns sheet with one account that has no Fidelity files
// (a workplace 401k), so the Portfolio picker shows a sheet-only entry.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthEnds = [];
trIdx.forEach((r, i) => { if (i === trIdx.length - 1 || trIdx[i + 1][0].slice(0, 7) !== r[0].slice(0, 7)) monthEnds.push(r); });
const sheetLines = ['S&P 500,,Roth 401k,'];
for (let i = 1; i < monthEnds.length - 1; i++) {
  const m = monthEnds[i][0], label = MON[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4);
  const sp = (monthEnds[i][1] / monthEnds[i - 1][1] - 1) * 100;
  const k = m >= '2023-01' ? (0.95 * sp + 0.6 * normal()).toFixed(2) + '%' : '';
  sheetLines.push([label, sp.toFixed(2) + '%', k ? label : '', k].join(','));
}

// ---------------------------------------------------------------- write
const history = {}, prices = {};
Object.keys(STOCKS).forEach(sym => {
  history[sym] = DAYS.map(d => [d, close[sym][d]]);
  prices[sym] = { price: close[sym][END], date: END };
});
const out = {
  about: 'Made-up sample data for Trading Performance: account, tickers, trades and prices (including the S&P 500 line) are all invented. Built by tools/make-sample.js.',
  built: END, seed: SEED,
  files, history, prices, trHistory: trIdx, indexExtra: pxIdx,
  sheet: { name: 'sample-monthly-returns.csv', csv: sheetLines.join('\n') + '\n' },
  accounts: { [ACCOUNT]: { name: 'Sample brokerage', type: 'Brokerage' } }
};
const dest = process.env.SAMPLE_OUT || path.join(__dirname, '..', 'sample', 'sample-data.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
console.log('wrote ' + path.relative(process.cwd(), dest) + ': ' + rows.length + ' transactions, ' +
  Object.keys(STOCKS).length + ' symbols, ' + DAYS.length + ' days, ' + (fs.statSync(dest).size / 1024).toFixed(0) + ' KB');
