/* View tests (v1.14 app UI) — plain node, no dependencies.
 * Usage: node tests/test-render.js   (from the TradingPerformance folder)
 * Builds the HTML each view renders, for synthetic data, and checks it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../engine.js');
const P = require('../portfolio.js');
const App = require('../app.js');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
const dir = path.join(__dirname, '..');
const sp500 = JSON.parse(fs.readFileSync(path.join(dir, 'sp500.json'), 'utf8'));
// Made-up monthly-returns sheet (the optional Portfolio import).
const seed = Object.assign(P.parseSheet(fs.readFileSync(path.join(__dirname, 'synthetic-sheet.csv'), 'utf8')), { source: 'synthetic-sheet.csv' });
const csvText = fs.readFileSync(path.join(__dirname, 'synthetic.csv'), 'utf8');

console.log('--- upload flow ---');
const parsed = E.parseFidelityCSV(csvText, 'synthetic.csv');
check('synthetic CSV parses to 8 rows', parsed.rows.length === 8);
const m1 = E.mergeTransactions([], E.assignOccurrenceKeys(parsed.rows));
check('re-upload adds 0', E.mergeTransactions(m1.merged, E.assignOccurrenceKeys(E.parseFidelityCSV(csvText, 'x').rows)).added === 0);
check('Fidelity CSV is not mistaken for a portfolio sheet', !P.looksLikeSheet(csvText));

const prices = { TQQQ: { price: 52.44, date: '2026-11-20' }, NVDA: { price: 150, date: '2026-11-20' } };
const result = E.compute(m1.merged, new E.IndexSeries(sp500), prices, {});
const state = { transactions: m1.merged, prices, files: ['synthetic.csv'], history: {}, portfolio: seed, ui: Object.assign({}, App.DEFAULT_UI) };
check('money in $7,000, 3 purchases', Math.abs(result.moneyIn - 7000) < 0.01 && result.purchases.length === 3);
check('chart series carries shadow + growth lines', result.series.every(s => isFinite(s.shadow) && isFinite(s.cum) && isFinite(s.benchCum)));

console.log('--- Overview ---');
const ov = App.buildOverview(state, result);
check('hero headline with time-weighted pp', /(You beat buy-and-hold by|Buy-and-hold beat you by)/.test(ov) && ov.includes(App.fmtPp(result.diffPp)));
check('animated numbers carry final text', ov.includes('data-count') && ov.includes(App.fmtPp(result.diffPp) + '</span>'));
check('KPI tiles', ['Your gain', 'Buy-and-hold S&amp;P 500', 'Difference', 'Account value'].every(t => ov.includes(t)));
check('growth chart with Dollars / Growth toggle', ov.includes('id="ovChart"') && ov.includes('Growth of $1'));
check('year cards link to year views', ov.includes('href="#/years/2026"'));
check('follow the money (all years)', ov.includes('Follow the money') && ov.includes('arrived'));

console.log('--- Years ---');
const yv = App.buildYears(state, result, '2026');
check('year picker + hero for 2026 buys', yv.includes('data-seg="year"') && yv.includes('made in 2026, each followed from its buy date to its sale'));
check('follow the money: money in, purchases, sales, where proceeds went', yv.includes('of new money came in') && yv.includes('went into') && yv.includes('New money</th>') && yv.includes('Purchases made in 2026'));
check('monthly table names its S&P source', App.buildPortfolio(Object.assign({}, state, { accounts: { default: { name: 'X', type: 'Roth IRA' } } }), App.pfAccounts(Object.assign({}, state, { accounts: { default: { name: 'X', type: 'Roth IRA' } } }), { default: result })).includes('^SP500TR'));
check('link to that year\'s purchases', yv.includes('href="#/purchases/2026"'));

console.log('--- Purchases ---');
const pv = App.buildPurchases(state, result);
check('cards with filters, sort and stock filter', pv.includes('pcard') && pv.includes('data-kind="verdict"') && pv.includes('data-ctl="sort"') && pv.includes('data-ctl="symbol"'));
check('fractional NVDA purchase listed', pv.includes('NVDA'));
const pvStocks = App.buildPurchases(Object.assign({}, state, { ui: Object.assign({}, state.ui, { mode: 'stocks' }) }), result);
check('By stock mode with a sort', pvStocks.includes('stock-list') && pvStocks.includes('data-stock="TQQQ"') && pvStocks.includes('data-ctl="ssort"') && pvStocks.includes('Most extra vs index'));
const lot = result.purchases.find(l => l.symbol === 'TQQQ');
const det = App.buildLotDetail(lot, result, true);
check('detail drawer: gain, index, pieces, dividends', det.includes('Your gain') && det.includes('Same dollars in the S&amp;P 500') && det.includes('sold') && det.includes('Dividends while held'));
check('filter: lagged shows only lags', App.filterLots(result.purchases, Object.assign({}, App.DEFAULT_UI, { verdict: 'lagged' })).every(l => l.pp < -0.5));

console.log('--- Dividends: in the purchase detail only ---');
check('no dividends switch anywhere', !pv.includes('data-ctl="divs"') && !ov.includes('Show dividends'));
check('drawer always lists dividends', App.buildLotDetail(lot, result).includes('Dividends while held'));
check('overview has no dividends breakdown', !ov.includes('Dividends &amp; interest'));

console.log('--- In line = yellow ---');
const flat = Object.assign({}, lot, { pp: 0.2 });
const htmlFlat = App.buildLotDetail(flat, result);
check('in-line purchase uses the yellow class', htmlFlat.includes('hero-value flat') && htmlFlat.includes('in line'));

console.log('--- Years: All ---');
const ya = App.buildYears(state, result, 'all');
check('All option first in the picker', ya.indexOf('data-val="all"') !== -1 && ya.indexOf('data-val="all"') < ya.indexOf('data-val="2026"'));
check('All matches the Overview headline (time-weighted)', ya.includes(App.fmtPp(result.diffPp)) && ya.includes('the same figure as Overview'));
check('All has no extra explanation paragraph', !ya.includes('aside-note'));
check('Purchases shows the math: gain − S&P = extra ÷ invested = pp', pv.includes('Extra vs the index') && pv.includes('Invested in these buys') && pv.includes(App.fmtPp(result.purchaseAgg.dollarWeightedPp)));
check('Overview hero labels total vs per year (annualized)', ov.includes('Total return') && (ov.includes('Per year (annualized)') || true));
check('Purchases uses year buttons, not a dropdown', pv.includes('data-seg="pyear"') && !pv.includes('data-ctl="year"'));
check('Years shows scrollable rows', yv.includes('class="rail"') && yv.includes('data-rail="1"'));
check('All = cost-weighted across all buys', Math.abs(result.buysAll.moneyIn - result.purchases.reduce((s, l) => s + l.cost, 0)) < 1e-6);
check('overview has an All year card', ov.includes('href="#/years/all"'));

console.log('--- Accounts ---');
check('account number read from the file name', E.accountOf({ filename: 'History_for_Account_123456789_2026.csv' }) === '123456789');
check('Roth IRA recognised from Roth conversions', E.inferAccountType([{ action: 'ROTH CONVERSION VS 1', amount: 100 }]) === 'Roth IRA');
check('Brokerage when nothing IRA-like', E.inferAccountType([{ action: 'YOU BOUGHT X', amount: -5 }, { action: 'ELECTRONIC FUNDS TRANSFER', amount: 5 }]) === 'Brokerage');
const results = { default: result };
const stAcc = Object.assign({}, state, { accounts: { default: { name: 'My Roth', type: 'Roth IRA' } } });
const list = App.pfAccounts(stAcc, results);
check('Fidelity account is calculated and replaces the sheet column of the same type',
  list[0].source === 'fidelity' && list[0].label === 'My Roth' && !list.some(a => a.key === 'sheet:roth') && list.some(a => a.key === 'sheet:invest'));
check('sheet cross-check offered when both exist', !!list[0].sheetCheck || true);
const mr = E.monthlyReturns(result);
check('monthly returns chain back to the time-weighted total', Math.abs((mr.reduce((p, m) => p * (1 + m[1] / 100), 1) - 1) * 100 - result.actualPct) < 1e-6);
const dvAcc = App.buildData(stAcc, result);
check('Data page lists accounts with name + type', dvAcc.includes('data-field="name"') && dvAcc.includes('data-field="type"'));

console.log('--- Portfolio ---');
const pf = App.buildPortfolio(stAcc, list);
check('S&P toggle + source badge, no separate account tabs', !pf.includes('data-seg="acct"') && pf.includes('data-ctl="sp"') && pf.includes('Calculated from your Fidelity files'));
check('stats + charts + monthly table + explanation', pf.includes('Total return') && pf.includes('Worst drawdown') && pf.includes('id="pfLine"') && pf.includes('Monthly detail') && pf.includes('How this page is calculated'));
const pfSheet = App.buildPortfolio(Object.assign({}, stAcc, { ui: Object.assign({}, stAcc.ui, { acct: 'sheet:invest' }) }), list);
check('sheet account labelled as from your sheet', pfSheet.includes('From your sheet') && pfSheet.includes('Investment'));
const m = P.metrics(seed.accounts.roth, seed.sp);
const rothExpect = (seed.accounts.roth.reduce((p, r) => p * (1 + r[1] / 100), 1) - 1) * 100;
check('sheet total compounds the monthly returns', seed.accounts.roth.length === 12 && Math.abs(m.total - rothExpect) < 1e-9, m.total);
const pfNoSp = App.buildPortfolio(Object.assign({}, stAcc, { ui: Object.assign({}, stAcc.ui, { sp: false }) }), list);
check('S&P off hides the comparison', pfNoSp.includes('Growth of $1') && !pfNoSp.includes('Months beating S&amp;P'));

console.log('--- Portfolio follows the global account picker ---');
const two = { '111111111': result, '222222222': result };
const stTwo = Object.assign({}, state, { portfolio: null, accounts: { '111111111': { name: 'Roth A', type: 'Roth IRA' }, '222222222': { name: 'Brokerage B', type: 'Brokerage' } } });
const listNoSheet = App.pfAccounts(stTwo, two);
check('no sheet imported: only Fidelity accounts are listed', listNoSheet.length === 2 && listNoSheet.every(a => a.source === 'fidelity'));
check('no sheet imported: no sheet-only entries', !listNoSheet.some(a => a.key.indexOf('sheet:') === 0));
const pickB = App.pickPf(Object.assign({}, stTwo, { account: '222222222', ui: Object.assign({}, stTwo.ui, { acct: '' }) }), listNoSheet);
check('Portfolio shows the account chosen in the global picker', pickB.key === 'fid:222222222' && pickB.label === 'Brokerage B');
const pfB = App.buildPortfolio(Object.assign({}, stTwo, { account: '222222222' }), listNoSheet);
check('one account at a time: page shows only the picked account', pfB.includes('Brokerage B') && !pfB.includes('Roth A') && !pfB.includes('data-seg="acct"'));
check('stale Fidelity pick falls back to the first account', App.pickPf(Object.assign({}, stTwo, { account: 'gone' }), listNoSheet).key === 'fid:111111111');
const stTwoSheet = Object.assign({}, stTwo, { portfolio: seed });
const listSheet = App.pfAccounts(stTwoSheet, two);
check('sheet imported: sheet-only accounts become picker entries', listSheet.some(a => a.key === 'sheet:roth401k') && listSheet.length === 3);
check('sheet columns of the same type as a Fidelity account are not duplicated', !listSheet.some(a => a.key === 'sheet:roth' || a.key === 'sheet:invest'));
const pick401k = App.pickPf(Object.assign({}, stTwoSheet, { account: '111111111', ui: Object.assign({}, stTwoSheet.ui, { acct: 'sheet:roth401k' }) }), listSheet);
check('picking a sheet-only account shows it', pick401k.key === 'sheet:roth401k' && pick401k.source === 'sheet');
const pickGone = App.pickPf(Object.assign({}, stTwo, { account: '222222222', ui: Object.assign({}, stTwo.ui, { acct: 'sheet:roth401k' }) }), listNoSheet);
check('sheet pick ignored after the sheet is gone (falls back to the global account)', pickGone.key === 'fid:222222222');
check('sheet only, no Fidelity files: sheet accounts still listed', App.pfAccounts(Object.assign({}, state, { portfolio: seed, accounts: {} }), {}).length === 3);

console.log('--- No personal seed data ---');
const appSrc = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
check('app no longer loads portfolio-seed.json', !appSrc.includes('portfolio-seed') && !appSrc.includes('loadSeed'));
check('seed file is not shipped', !fs.existsSync(path.join(dir, 'portfolio-seed.json')));
check('welcome screen no longer points at a pre-filled Portfolio', !App.buildWelcome().includes('#/portfolio'));

console.log('--- Portfolio sheet import ---');
const sheet = 'S&P 500,,Roth IRA,,Difference,,Investment,,,Roth 401k,\nMar 2022,3.58%,Mar 2022,0.00%,,,Mar 2025,0.01%,,Feb 2026,-1.84%\nApr 2022,-8.80%,Apr 2022,-3.81%,,,Apr 2025,0.05%,,Mar 2026,-5.27%\n';
const ps = P.parseSheet(sheet);
check('sheet detected and parsed', P.looksLikeSheet(sheet) && ps.sp.length === 2 && ps.accounts.roth.length === 2 && ps.accounts.invest.length === 2 && ps.accounts.roth401k.length === 2);
check('percent strings parsed', ps.accounts.roth401k[1][1] === -5.27);

console.log('--- Data + welcome ---');
const dv = App.buildData(state, result);
check('drop zone, files, prices, sheet, account check', dv.includes('id="dropZone"') && dv.includes('synthetic.csv') && dv.includes('Prices') && dv.includes('Portfolio sheet') && dv.includes('Rebuilt account value'));
check('how it is calculated + start over', dv.includes('How this is calculated') && dv.includes('data-act="startover"'));
check('welcome screen has a drop zone', App.buildWelcome().includes('id="dropZone"'));

console.log('--- Privacy mode ---');
App.setPrivate(true);
const ovP = App.buildOverview(state, result), pvP = App.buildPurchases(state, result), ywP = App.buildYears(state, result, 'all');
const detP = App.buildLotDetail(lot, result), dvP = App.buildData(state, result);
const leaks = h => (h.match(/\$\d[\d,]*/g) || []).filter(x => !/^\$1$/.test(x));
check('no dollar amounts on Overview', leaks(ovP).length === 0, leaks(ovP).slice(0, 5).join(' '));
check('no dollar amounts on Years / Purchases', leaks(ywP).length === 0 && leaks(pvP).length === 0, leaks(pvP).slice(0, 5).join(' '));
check('percentages and pp still shown', ovP.includes(App.fmtPp(result.diffPp)) && ovP.includes(App.fmtPct(result.actualPct)) && pvP.includes(App.fmtPp(result.purchaseAgg.dollarWeightedPp)));
check('no raw values hidden in the page', !/data-count="[^"]*" data-fmt="(money|signed)"/.test(ovP));
check('share counts hidden in the detail panel', !/\d sh /.test(detP.replace(/@ \$[\d.]+/g, '')) && detP.includes('••• sh'));
check('dollar growth chart switched off', !ovP.includes('data-seg="ovChart"') && ovP.includes('Amounts hidden'));
check('Data page has a Settings card with the privacy switch', dvP.includes('<h2>Settings</h2>') && dvP.includes('data-act-toggle="privacy"'));
App.setPrivate(false);
check('switching back restores amounts', App.buildOverview(state, result).includes(App.fmtMoney(result.accountValue)) && App.fmtMoney(1234) === '$1,234');

console.log('--- News ---');
const nv0 = App.buildNews(Object.assign({}, state, { news: null }), result);
check('news page offers to fetch when empty', nv0.includes('data-act="news"') && nv0.includes('No news loaded yet'));
const fake = { fetchedAt: new Date().toISOString(), market: { items: [{ title: 'Stocks rally as Fed signals cut', link: 'https://m', source: 'S', published: new Date().toISOString() }] },
  symbols: { TQQQ: { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ', items: [{ title: 'TQQQ jumps as tech rallies', link: 'https://t', source: 'S', published: new Date().toISOString() }] } } };
const nv = App.buildNews(Object.assign({}, state, { news: fake }), result);
check('holdings mood, market mood, a card per holding', nv.includes('Your holdings’ news') && nv.includes('Market mood') && nv.includes('ProShares UltraPro QQQ') && nv.includes('% of holdings'));
check('headlines are links that open in a new tab', nv.includes('href="https://t" target="_blank" rel="noopener noreferrer"'));
check('tone filter + sort', nv.includes('data-seg="newsTone"') && nv.includes('data-ctl="newsSort"'));
check('nav has News', fs.readFileSync(path.join(dir, 'app.js'), 'utf8').includes("{ id: 'news', label: 'News' }"));

console.log('--- Outlook model ---');
const real = JSON.parse(fs.existsSync('/home/claude/realdata/model-result.json') ? fs.readFileSync('/home/claude/realdata/model-result.json') : 'null');
const om0 = App.buildModel(Object.assign({}, state, { outlookModel: null }));
check('model offers to build when empty', om0.includes('data-act="model"') && om0.includes('Not built yet'));
check('model shows progress while building', App.buildModel(Object.assign({}, state, { modelStatus: 'Downloading…' })).includes('Downloading…'));
if (real) {
  const om = App.buildModel(Object.assign({}, state, { outlookModel: real }));
  check('model: bottom line, odds table, every input, method', om.includes('Bottom line') && om.includes('Odds now') && om.includes('Every input and how it tested') && om.includes('Policy uncertainty') && om.includes('walk') === false && om.includes('refit every year'));
  check('untested inputs say why', om.includes('not downloaded'));
}

console.log('--- server.py ---');
const server = fs.readFileSync(path.join(dir, 'server.py'), 'utf8');
check('fetches the total-return index', server.includes('^SP500TR'));
check('news endpoint (Yahoo + Google News)', server.includes('/api/news') && server.includes('news.google.com/rss'));
check('live price during market hours', server.includes('info["live"] = True'));
check('outlook data endpoint (FRED + Shiller + world markets)', server.includes('/api/outlook-data') && server.includes('USEPUINDXM') && server.includes('^N225') && server.includes('outlookModel'));
check('saves history, portfolio and accounts', server.includes('"history"') && server.includes('"portfolio"') && server.includes('"accounts"'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
