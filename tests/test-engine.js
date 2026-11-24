/* Engine tests (v1.14) — plain node, no dependencies.
 * Usage: node tests/test-engine.js   (from the TradingPerformance folder)
 * Hand-computed scenarios for the time-weighted method.
 */
'use strict';
const E = require('../engine.js');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
const near = (a, b, tol) => Math.abs(a - b) < (tol || 0.01);
function tx(date, action, symbol, quantity, price, amount, cashBalance) {
  return { date, action, symbol: symbol || '', quantity: quantity || 0, price: price || 0,
    amount, fees: 0, cashBalance, key: [date, action, symbol, quantity, amount].join('|') };
}
const days = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'];

console.log('--- time-weighted return, deposits do not distort it ---');
{
  // Day 1: deposit $1,000, buy 10 XYZ @ $100. Day 2: XYZ 110, deposit $1,000
  // (stays cash). Day 3: XYZ 121. Index flat-then-+10%.
  const t = [
    tx(days[0], 'CASH CONTRIBUTION CURRENT YEAR', '', 0, 0, 1000, 1000),
    tx(days[0], 'YOU BOUGHT XYZ', 'XYZ', 10, 100, -1000, 0),
    tx(days[1], 'CASH CONTRIBUTION CURRENT YEAR', '', 0, 0, 1000, 1000)
  ];
  const index = new E.IndexSeries([[days[0], 100], [days[1], 100], [days[2], 110]]);
  const hist = { XYZ: [[days[0], 100], [days[1], 110], [days[2], 121]] };
  const r = E.compute(t, index, {}, { history: hist, indexIsTotalReturn: true });
  // Day 2: V = 1100 + 1000 = 2100 on base 1000 + 1000 -> +5%.
  // Day 3: V = 1210 + 1000 = 2210 -> 2210/2100 - 1.
  const twr = 1.05 * (2210 / 2100) - 1;
  check('TWR chains daily returns', near(r.actualPct, twr * 100, 1e-6), r.actualPct + ' vs ' + twr * 100);
  check('S&P TWR = index end/start', near(r.baselinePct, 10, 1e-6), r.baselinePct);
  check('pp = TWR difference', near(r.diffPp, (twr - 0.10) * 100, 1e-6));
  check('money in = deposits only ($2,000)', near(r.moneyIn, 2000));
  check('account value $2,210', near(r.accountValue, 2210));
  check('your gain $210', near(r.actualGain, 210));
  check('buy-and-hold: both deposits earn +10% = $200', near(r.baselineGain, 200));
  check('difference +$10', near(r.diff, 10));
  check('cash matches the Cash Balance column', r.cashCheck.checked === 2 && r.cashCheck.matched === 2, JSON.stringify(r.cashCheck));
}

console.log('--- dividends and interest are returns, not money in ---');
{
  const t = [
    tx(days[0], 'CASH CONTRIBUTION CURRENT YEAR', '', 0, 0, 1000),
    tx(days[0], 'YOU BOUGHT XYZ', 'XYZ', 10, 100, -1000),
    tx(days[1], 'DIVIDEND RECEIVED XYZ', 'XYZ', 0, 0, 20),
    tx(days[1], 'REINVESTMENT XYZ', 'XYZ', 0.2, 100, -20),
    tx(days[2], 'DIVIDEND RECEIVED FIDELITY GOVERNMENT MONEY MARKET (SPAXX)', 'SPAXX', 0, 0, 5),
    tx(days[2], 'REINVESTMENT FIDELITY GOVERNMENT MONEY MARKET (SPAXX)', 'SPAXX', 5, 1, -5)
  ];
  const index = new E.IndexSeries([[days[0], 100], [days[2], 100]]);
  const r = E.compute(t, index, {}, { history: { XYZ: [[days[0], 100]] }, indexIsTotalReturn: true });
  check('money in stays $1,000', near(r.moneyIn, 1000), r.moneyIn);
  check('gain = $20 dividend + $5 interest', near(r.actualGain, 25), r.actualGain);
  check('reinvested shares held (10.2 XYZ)', near(r.holdings.XYZ.shares, 10.2, 1e-9));
  check('SPAXX interest stays cash ($5)', near(r.cash, 5));
  check('benchmark gain 0 on a flat index', near(r.baselineGain, 0));
  check('income reported $25', near(r.income, 25));
  check('card includes the dividend, reinvested as +0.2 sh', near(r.purchases[0].dividendsTotal, 20) &&
    near(r.purchases[0].dripShares, 0.2, 1e-9) && near(r.purchases[0].totalGain, 20), r.purchases[0].totalGain);
  check('reinvestment makes no card', r.purchases.length === 1);
}

console.log('--- an index fund that reinvests dividends matches the total-return index ---');
{
  // Fund price = price index. Quarterly 0.4% dividends, reinvested at the
  // day's price. The total-return index compounds the same dividends. A
  // buy-and-sell of the fund must come out at ~0 pp vs the index.
  const dates = [], px = [], t = [];
  let p = 100, tr = 1000;
  for (let i = 0; i < 12; i++) {
    const d = '2024-' + String(i + 1).padStart(2, '0') + '-15';
    if (i > 0) { p *= 1 + 0.02 * Math.sin(i); tr *= 1 + 0.02 * Math.sin(i); }
    dates.push(d); px.push([d, p]);
  }
  const trRows = [];
  t.push(tx(dates[0], 'CASH CONTRIBUTION CURRENT YEAR', '', 0, 0, 1000));
  t.push(tx(dates[0], 'YOU BOUGHT FUND', 'FUND', 10, 100, -1000));
  let sh = 10;
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 3 === 0) {
      const div = sh * px[i][1] * 0.004;
      t.push(tx(dates[i], 'DIVIDEND RECEIVED FUND', 'FUND', 0, 0, div));
      t.push(tx(dates[i], 'REINVESTMENT FUND', 'FUND', div / px[i][1], px[i][1], -div));
      sh += div / px[i][1];
    }
  }
  // Build the TR series the same way: price moves x (1 + yield) on dividend days.
  let trv = 1000;
  for (let i = 0; i < 12; i++) {
    if (i > 0) trv *= px[i][1] / px[i - 1][1];
    if (i > 0 && i % 3 === 0) trv *= 1.004;
    trRows.push([dates[i], trv]);
  }
  t.push(tx(dates[11], 'YOU SOLD FUND', 'FUND', sh, px[11][1], sh * px[11][1]));
  const r = E.compute(t, new E.IndexSeries(trRows), {}, { history: { FUND: px }, indexIsTotalReturn: true });
  const card = r.purchases[0];
  check('one card, fully sold', r.purchases.length === 1 && card.status === 'sold');
  check('card vs index ~0 pp', Math.abs(card.pp) < 0.01, card.pp);
  check('year view ~0 pp', Math.abs(r.cohorts['2024'].diffPp) < 0.01, r.cohorts['2024'].diffPp);
  check('time-weighted headline ~0 pp', Math.abs(r.diffPp) < 0.01, r.diffPp);
}

console.log('--- fractional shares count; same-day split rows are one purchase ---');
{
  const t = [
    tx(days[0], 'CASH CONTRIBUTION CURRENT YEAR', '', 0, 0, 1000),
    tx(days[0], 'YOU BOUGHT XYZ', 'XYZ', 9, 100, -900),
    tx(days[0], 'YOU BOUGHT XYZ', 'XYZ', 0.5, 100, -50),
    tx(days[2], 'YOU SOLD XYZ', 'XYZ', 9, 120, 1080),
    tx(days[2], 'YOU SOLD XYZ', 'XYZ', 0.25, 120, 30)
  ];
  const index = new E.IndexSeries([[days[0], 100], [days[2], 100], [days[3], 100]]);
  const r = E.compute(t, index, {}, { history: { XYZ: [[days[0], 100], [days[2], 120], [days[3], 130]] }, indexIsTotalReturn: true });
  check('one card for the 9 + 0.5 order', r.purchases.length === 1 && near(r.purchases[0].shares, 9.5, 1e-9));
  check('0.25 sh still held', near(r.purchases[0].remaining, 0.25, 1e-9) && r.purchases[0].status === 'partly');
  check('sold piece merges whole + fractional rows (9.25 sh)', r.purchases[0].soldPieces.length === 1 &&
    near(r.purchases[0].soldPieces[0].shares, 9.25, 1e-9));
  // Value: 0.25 * 130 + cash (1000 - 950 + 1110) = 32.5 + 1160
  check('account value includes the fraction', near(r.accountValue, 1192.5), r.accountValue);
  check('card gain = 9.25*20 + 0.25*30', near(r.purchases[0].totalGain, 185 + 7.5), r.purchases[0].totalGain);
  check('only one sale in the journey', r.journeys.all.sales.length === 1);
}

console.log('--- Roth conversion of shares, transfers out ---');
{
  const t = [
    tx(days[0], 'ROTH CONVERSION VS 000 AMERICAN EXPRESS (AXP)', 'AXP', 2, 0, 500, 0),
    tx(days[1], 'CASH CONTRIBUTION CURRENT YEAR', '', 0, 0, 300, 300),
    tx(days[2], 'TRANSFERRED TO VS 111', '', 0, 0, -100, 200)
  ];
  const index = new E.IndexSeries([[days[0], 100], [days[1], 100], [days[2], 100]]);
  const r = E.compute(t, index, {}, { history: { AXP: [[days[0], 250], [days[2], 260]] }, indexIsTotalReturn: true });
  check('money in = 500 + 300 - 100', near(r.moneyIn, 700));
  check('conversion shares held, cash untouched', near(r.holdings.AXP.shares, 2) && near(r.cash, 200));
  check('gain = 2 x $10', near(r.actualGain, 20), r.actualGain);
  check('conversion card funded by new money', near(r.purchases[0].fundingNew, 500));
}

console.log('--- year views: buys followed to their sale, not to Dec 31 ---');
{
  // 2025 buy at 100; year-end 2025 it is DOWN (90), sold Mar 2026 at 130.
  // The 2025 view must judge the buy through the sale, not stop at Dec 31.
  const t = [
    tx('2025-06-02', 'CASH CONTRIBUTION CURRENT YEAR', '', 0, 0, 1000),
    tx('2025-06-02', 'YOU BOUGHT XYZ', 'XYZ', 10, 100, -1000),
    tx('2026-03-02', 'YOU SOLD XYZ', 'XYZ', 10, 130, 1300),
    tx('2026-04-01', 'YOU BOUGHT ABC', 'ABC', 5, 200, -1000)
  ];
  const index = new E.IndexSeries([['2025-06-02', 100], ['2025-12-31', 95], ['2026-03-02', 120], ['2026-04-01', 120], ['2026-06-01', 132]]);
  const hist = { XYZ: [['2025-06-02', 100], ['2025-12-31', 90], ['2026-03-02', 130]], ABC: [['2026-04-01', 200], ['2026-06-01', 210]] };
  const r = E.compute(t, index, {}, { history: hist, indexIsTotalReturn: true });
  const c25 = r.cohorts['2025'];
  check('2025 gain = the full round trip (+$300), not the Dec 31 dip', near(c25.actual, 300), c25.actual);
  check('2025 S&P over the same dates (+20%)', near(c25.baseline, 200) && near(c25.baselinePct, 20, 1e-6));
  check('2025 pp = +10', near(c25.diffPp, 10, 1e-6));
  check('2025 window runs to the sale date', c25.from === '2025-06-02' && c25.to === '2026-03-02');
  const j = r.journeys['2025'];
  check('2025 journey: 1 buy, 1 sale for $1,300', j.buys.length === 1 && j.sales.length === 1 && near(j.salesTotal, 1300));
  check('2025 proceeds followed into the 2026 ABC buy ($1,000)', j.later.length === 1 && j.later[0].symbol === 'ABC' && near(j.laterTotal, 1000));
  const c26 = r.cohorts['2026'];
  check('2026 judges only the ABC buy (held to today): +$50 vs +10% S&P', near(c26.actual, 50) && near(c26.baseline, 100), c26.actual + ' ' + c26.baseline);
  check('ABC bought with reinvested money', near(c26.reinvested, 1000) && near(c26.newMoney, 0));
  check('all-years headline stays time-weighted', near(r.actualPct, 35, 1e-6), r.actualPct);
}

console.log('--- benchmark series ---');
{
  const tr = [['2026-01-05', 1000], ['2026-01-06', 1010]];
  const px = [['2026-01-05', 500], ['2026-01-06', 505], ['2026-01-07', 510.05]];
  const b = E.buildBenchmark(tr, px);
  check('total return extended with price moves', b.isTotalReturn && b.rows.length === 3 && near(b.rows[2][1], 1020.1, 1e-6));
  const f = E.buildBenchmark([], px);
  check('falls back to the price index', !f.isTotalReturn && f.rows.length === 3);
  const t = [tx(days[0], 'CASH CONTRIBUTION CURRENT YEAR', '', 0, 0, 100)];
  const r = E.compute(t, new E.IndexSeries(px), {}, {});
  check('price-index fallback is flagged', r.warnings.some(w => w.indexOf('price index') !== -1));
}

console.log('--- parsing + dedupe ---');
{
  const csv = 'Run Date,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Cash Balance ($),Settlement Date\n' +
    '02/25/2025,YOU SOLD FIDELITY 500 INDEX FUND (FXAIX) (Cash),FXAIX,X,Cash,207.12,"-9.656","","","",2000,9471.15,02/26/2025\n' +
    '02/25/2025,YOU SOLD FIDELITY 500 INDEX FUND (FXAIX) (Cash),FXAIX,X,Cash,207.12,"-9.656","","","",2000,7471.15,02/26/2025\n';
  const p = E.parseFidelityCSV(csv, 'a.csv');
  check('sale quantity normalized positive', p.rows[0].quantity === 9.656);
  check('cash balance parsed', p.rows[0].cashBalance === 9471.15);
  const k = E.assignOccurrenceKeys(p.rows);
  check('identical rows both kept', E.mergeTransactions([], k).merged.length === 2);
  const old = E.assignOccurrenceKeys(E.parseFidelityCSV(csv, 'a.csv').rows).map(r => { delete r.cashBalance; return r; });
  const m = E.mergeTransactions(old, E.assignOccurrenceKeys(E.parseFidelityCSV(csv, 'a.csv').rows));
  check('re-upload fills Cash Balance into older saved rows', m.added === 0 && m.merged[0].cashBalance === 9471.15);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
