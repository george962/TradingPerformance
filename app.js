/* Trading Performance vs S&P 500 — app UI (v1.14).
 * Hash-routed single-page app: Overview, Years, Purchases, Portfolio, Data.
 * View builders are pure (return HTML strings) so they can be tested in
 * Node; the browser part wires navigation, charts, the drawer, uploads.
 */
(function () {
  'use strict';
  var E = typeof window !== 'undefined' ? window.TradingEngine : require('./engine.js');
  var P = typeof window !== 'undefined' ? window.Portfolio : require('./portfolio.js');
  var N = typeof window !== 'undefined' ? window.NewsTone : require('./news.js');
  var EC = typeof window !== 'undefined' ? window.Economy : require('./economy.js');

  // ------------------------------------------------------------ formatting
  function addCommas(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  // Privacy mode: dollar amounts and share counts become "•••"; percentages,
  // pp and charts of growth stay visible (for showing performance to others).
  var PRIVATE = false, MASK = '•••';
  function setPrivate(on) { PRIVATE = !!on; }
  function fmtMoney(x) { return (x < 0 ? '−' : '') + '$' + (PRIVATE ? MASK : addCommas(String(Math.abs(Math.round(x))))); }
  function fmtSignedMoney0(x) { return (x < 0 ? '−' : '+') + '$' + (PRIVATE ? MASK : addCommas(String(Math.abs(Math.round(x))))); }
  function fmtMoney2(x) { return (x < 0 ? '−' : '+') + '$' + (PRIVATE ? MASK : addCommas(Math.abs(x).toFixed(2))); }
  function maskText(t) { return PRIVATE ? String(t).replace(/\$[\d,]+(\.\d+)?/g, '$' + MASK).replace(/\b\d+(\.\d+)? (more )?(sh|shares)\b/g, MASK + ' $3') : t; }
  function fmtPct(x, d) { return (x < 0 ? '−' : '+') + Math.abs(x).toFixed(d === undefined ? 2 : d) + '%'; }
  function fmtPp(x) { return (x < 0 ? '−' : '+') + Math.abs(x).toFixed(2) + ' pp'; }
  function fmtShares(x) { return PRIVATE ? MASK : String(Math.round(x * 1000) / 1000); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return p.length === 3 ? MON[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0] : iso;
  }
  function fmtDateShort(iso) { var p = (iso || '').split('-'); return p.length === 3 ? MON[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0].slice(2) : iso; }
  function fmtMonthYr(iso) { var p = (iso || '').split('-'); return p.length >= 2 ? MON[+p[1] - 1] + ' ’' + p[0].slice(2) : iso; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cls(x) { return x < 0 ? 'neg' : 'pos'; }
  // Verdict colour for a purchase: beat (> +0.5 pp) green, lagged (< −0.5 pp)
  // red, in line (within ±0.5 pp — e.g. an S&P 500 fund like FXAIX) yellow.
  function vcls(pp) { return pp > 0.5 ? 'pos' : pp < -0.5 ? 'neg' : 'flat'; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  // Animated number: final text is rendered, the browser counts up to it.
  var FMT = { pp: fmtPp, money: fmtMoney, signed: fmtSignedMoney0, pct: fmtPct };
  function num(v, f) {
    if (PRIVATE && (f === 'money' || f === 'signed')) return '<span>' + FMT[f](v) + '</span>'; // no raw value in the page
    return '<span data-count="' + v + '" data-fmt="' + f + '">' + FMT[f](v) + '</span>';
  }

  // ------------------------------------------------------------ icons
  var ICON = {
    overview: '<path d="M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
    years: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    purchases: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    portfolio: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
    data: '<path d="M12 3v12M7 8l5-5 5 5M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4"/>',
    news: '<path d="M4 5h13v14a1 1 0 01-1 1H5a1 1 0 01-1-1zM17 9h3v10a1 1 0 01-1 1h-2M7 9h7M7 13h7M7 16h4"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
    file: '<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>'
  };
  function icon(n) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON[n] + '</svg>';
  }
  var NAV = [
    { id: 'overview', label: 'Overview' }, { id: 'years', label: 'Years' },
    { id: 'purchases', label: 'Purchases' }, { id: 'portfolio', label: 'Portfolio' }, { id: 'news', label: 'News' }, { id: 'data', label: 'Data' }
  ];

  function mergeIndex(base, extra) {
    var map = {};
    (base || []).forEach(function (r) { map[r[0]] = r[1]; });
    (extra || []).forEach(function (r) { map[r[0]] = r[1]; });
    return Object.keys(map).sort().map(function (d) { return [d, map[d]]; });
  }

  // ------------------------------------------------------------ shared pieces
  function seg(id, items, active) {
    return '<div class="seg" data-seg="' + id + '">' + items.map(function (it) {
      return '<button type="button" data-val="' + esc(it.v) + '" class="' + (String(it.v) === String(active) ? 'active' : '') + '">' + esc(it.l) + '</button>';
    }).join('') + '<span class="thumb"></span></div>';
  }
  function hero(label, value, sub, behind, meta) {
    return '<section class="hero' + (behind ? ' behind' : '') + '"><div class="hero-label">' + label + '</div>' +
      '<div class="hero-value ' + cls(value) + '">' + num(value, 'pp') + '</div><div class="hero-sub">' + sub + '</div>' +
      (meta ? '<div class="hero-meta">' + meta + '</div>' : '') + '</section>';
  }
  function kpi(label, value, f, sub, tone) {
    return '<div class="card kpi ' + (tone || (f === 'money' ? 'neu' : cls(value))) + '"><div class="eyebrow">' + label + '</div>' +
      '<div class="kpi-value ' + (f === 'money' ? '' : cls(value)) + '">' + num(value, f) + '</div><div class="kpi-sub">' + sub + '</div></div>';
  }
  function step(n, dates, text, more) {
    return '<div class="step done"><div class="step-dot">' + n + '</div><div class="step-body">' +
      (dates ? '<div class="step-dates">' + dates + '</div>' : '') + '<div class="step-text">' + text + '</div>' + (more || '') + '</div></div>';
  }
  function moreTable(summary, cols, rows) {
    if (!rows.length) return '';
    return '<details class="more"><summary>' + summary + '</summary><div class="more-body"><div class="table-wrap"><table class="t"><tr>' +
      cols.map(function (c) { return '<th' + (c.num ? ' class="num"' : '') + '>' + c.h + '</th>'; }).join('') + '</tr>' +
      rows.map(function (r) {
        return '<tr>' + cols.map(function (c) {
          return '<td class="' + (c.num ? 'num ' : '') + (c.tone ? cls(c.tone(r)) : '') + '">' + c.f(r) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</table></div></div></details>';
  }
  function range(r) { return r ? fmtDate(r.from) + (r.to !== r.from ? ' – ' + fmtDate(r.to) : '') : ''; }
  var C = {
    date: { h: 'Date', f: function (b) { return fmtDate(b.date); } },
    sym: { h: 'Symbol', f: function (b) { return esc(b.symbol); } },
    amt: { h: 'Amount', num: true, f: function (b) { return fmtMoney(b.amount); } },
    gain: { h: 'Gain', num: true, tone: function (b) { return b.gain; }, f: function (b) { return fmtSignedMoney0(b.gain); } }
  };
  function arrivalLabel(t) {
    return { contribution: 'Contribution', rollover: 'Rollover', transfer: 'Transfer in', conversion: 'Roth conversion', withdrawal: 'Transfer out' }[t] || t;
  }

  // ------------------------------------------------------------ Overview
  function heroBlock(label, value, sub, when, behind, compare) {
    return '<section class="hero' + (behind ? ' behind' : '') + '"><div class="hero-label">' + label + '</div>' +
      '<div class="hero-value ' + cls(value) + '">' + num(value, 'pp') + '</div><div class="hero-sub">' + sub +
      (when ? '<span class="when">' + when + '</span>' : '') + '</div>' +
      (typeof compare === 'string' ? compare : compare && compare.length ? '<div class="compare">' + compare.map(function (c) {
        return '<div><div class="c-l">' + c.l + '</div><div class="c-v' + (c.tone !== undefined ? ' ' + cls(c.tone) : '') + '">' + c.v + '</div></div>';
      }).join('') + '</div>' : '') + '</section>';
  }
  function b(x) { return '<b>' + x + '</b>'; }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  // Two labelled groups so "per year" can't be mistaken for the total.
  function twrCompare(r) {
    function g(title, you, sp) {
      return '<div class="cg"><div class="cg-l">' + title + '</div><div class="cg-row">' +
        '<div><div class="c-l">You</div><div class="c-v ' + cls(you) + '">' + fmtPct(you) + '</div></div>' +
        '<div><div class="c-l">S&amp;P 500</div><div class="c-v ' + cls(sp) + '">' + fmtPct(sp) + '</div></div></div></div>';
    }
    return '<div class="compare groups">' + g('Total return', r.actualPct, r.baselinePct) +
      (r.days > 400 ? g('Per year (annualized)', r.actualAnnPct, r.baselineAnnPct) : '') + '</div>';
  }
  function twr(result) {
    return { actualPct: result.actualPct, baselinePct: result.baselinePct, actualAnnPct: result.actualAnnPct,
      baselineAnnPct: result.baselineAnnPct, days: (Date.parse(result.endDate) - Date.parse(result.startDate)) / 864e5 };
  }
  function buildOverview(state, result) {
    var divs = false; // dividends are shown on the Purchases page only
    var h = heroBlock(result.diffPp >= 0 ? 'You beat buy-and-hold by' : 'Buy-and-hold beat you by', result.diffPp,
      'Your time-weighted return vs. the S&amp;P 500 with dividends reinvested.',
      fmtDate(result.startDate) + ' – ' + fmtDate(result.endDate) + (result.live ? ' · live' : ''), result.diffPp < 0, twrCompare(twr(result)));
    h += '<div class="kpis">' +
      kpi('Your gain', result.actualGain, 'signed', b(fmtPct(result.actualPct)) + ' time-weighted') +
      kpi('Buy-and-hold S&amp;P 500', result.baselineGain, 'signed', b(fmtPct(result.baselinePct)) + ' time-weighted') +
      kpi('Difference', result.diff, 'signed', 'on ' + b(fmtMoney(result.moneyIn)) + ' of new money') +
      kpi('Account value', result.accountValue, 'money', 'holdings ' + b(fmtMoney(result.holdingsValue)) + ' · cash ' + b(fmtMoney(result.cash))) +
      '</div>';
    h += '<section class="section card pad" style="margin-top:22px"><div class="section-head"><h2>Growth</h2>' +
      '<span class="hint" id="chartHint">your account vs. the same deposits in the S&amp;P 500</span><div class="right">' +
      (PRIVATE ? '<span class="chip">Amounts hidden</span>' : seg('ovChart', [{ v: 'dollars', l: 'Dollars' }, { v: 'growth', l: 'Growth of $1' }], state.ui.chart)) + '</div></div>' +
      '<div class="legend" id="ovLegend"></div><div class="chart" id="ovChart" style="margin-top:8px"></div></section>';
    var years = Object.keys(result.cohorts).sort().reverse();
    var maxPp = years.reduce(function (m, y) { return Math.max(m, Math.abs(result.cohorts[y].diffPp)); }, Math.abs(result.diffPp)) || 1;
    function ycard(key, label, c) {
      var w = Math.min(50, Math.abs(c.diffPp) / maxPp * 50);
      return '<a class="card year-card" href="#/years/' + key + '"><div class="y">' + label + '</div><div class="pp ' + cls(c.diffPp) + '">' + fmtPp(c.diffPp) + '</div>' +
        '<div class="d">' + fmtSignedMoney0(c.diff) + ' vs S&amp;P · ' + (key === 'all' ? 'whole account' : plural(c.count, 'buy')) + '</div>' +
        '<div class="minibar"><span class="' + cls(c.diffPp) + '" style="width:' + w.toFixed(1) + '%"></span></div></a>';
    }
    h += '<section class="section"><div class="section-head"><h2>Each year’s buys</h2><span class="hint">followed from purchase to sale</span></div><div class="year-strip">' +
      ycard('all', 'All', { diffPp: result.diffPp, diff: result.diff }) + years.map(function (y) { return ycard(y, y, result.cohorts[y]); }).join('') + '</div></section>';
    var j = result.journeys.all;
    h += '<section class="section card pad"><div class="section-head"><h2>Follow the money</h2><span class="hint">all years</span></div><div class="steps">' +
      step(1, range(j.arrivalsRange), '<strong>' + fmtMoney(result.inflows) + '</strong> arrived' +
        (divs && result.income > 0.5 ? ', and your holdings and cash earned <strong>' + fmtMoney(result.income) + '</strong> in dividends and interest.' : '.'),
        moreTable('See all ' + plural(j.arrivals.length, 'arrival'), [C.date, { h: 'Type', f: function (a) { return arrivalLabel(a.type); } }, C.amt], j.arrivals)) +
      step(2, range(j.firstBuysRange), '<strong>' + fmtMoney(j.firstBuysTotal) + '</strong> of new money went into ' + plural(j.firstBuys.length, 'purchase') +
        ', which gained <strong class="' + cls(j.firstBuysGain) + '">' + fmtSignedMoney0(j.firstBuysGain) + '</strong>.',
        moreTable('See those purchases', [C.date, C.sym, C.amt, C.gain], j.firstBuys)) +
      step(3, j.phaseRange ? range(j.phaseRange) : '', plural(j.sales.length, 'sale') + ' brought in <strong>' +
        fmtMoney(j.sales.reduce(function (s, x) { return s + x.proceeds; }, 0)) + '</strong>, which paid for <strong>' +
        fmtMoney(j.reinvestedTotal) + '</strong> of later buys that gained <strong class="' + cls(j.reinvestedGain) + '">' + fmtSignedMoney0(j.reinvestedGain) + '</strong>.',
        moreTable('See the reinvested buys', [C.date, C.sym, C.amt, C.gain], j.reinvested)) +
      step(4, fmtDate(result.endDate), 'Today: <strong>' + fmtMoney(result.accountValue) + '</strong> — a gain of <strong class="' + cls(result.actualGain) + '">' +
        fmtSignedMoney0(result.actualGain) + '</strong> vs. <strong class="' + cls(result.baselineGain) + '">' + fmtSignedMoney0(result.baselineGain) + '</strong> for the same deposits in the S&amp;P 500.') +
      '</div></section>';
    if (divs) h += buildDividends(result);
    if (result.warnings.length) {
      h += '<section class="section"><div class="warn">' + plural(result.warnings.length, 'note') + ' about your data — <a href="#/data">see Data</a>.</div></section>';
    }
    return h;
  }
  // Dividends & interest (shown only when "Show dividends" is on; always
  // counted in every figure either way).
  function buildDividends(result) {
    var rows = result.dividendRows || [];
    if (!rows.length) return '';
    var byYear = {}, bySym = {};
    rows.forEach(function (r) {
      var y = r.date.slice(0, 4), s = MM[r.symbol] ? 'Interest (' + r.symbol + ')' : r.symbol;
      byYear[y] = (byYear[y] || 0) + r.amount; bySym[s] = (bySym[s] || 0) + r.amount;
    });
    var total = rows.reduce(function (s, r) { return s + r.amount; }, 0);
    return '<section class="section card pad"><div class="section-head"><h2>Dividends &amp; interest</h2><span class="hint">' + fmtMoney(total) +
      ' received · already counted in your gain</span></div><div class="grid2">' +
      '<div class="table-wrap"><table class="t"><tr><th>Year</th><th class="num">Received</th></tr>' + Object.keys(byYear).sort().reverse().map(function (y) {
        return '<tr><td>' + y + '</td><td class="num">' + fmtMoney2(byYear[y]).replace('+', '') + '</td></tr>'; }).join('') + '</table></div>' +
      '<div class="table-wrap"><table class="t"><tr><th>From</th><th class="num">Received</th></tr>' + Object.keys(bySym).sort(function (a, c) { return bySym[c] - bySym[a]; }).map(function (s) {
        return '<tr><td>' + esc(s) + '</td><td class="num">' + fmtMoney2(bySym[s]).replace('+', '') + '</td></tr>'; }).join('') + '</table></div></div></section>';
  }
  var MM = { SPAXX: 1, FDRXX: 1, SPRXX: 1, FZFXX: 1, FCASH: 1 };

  // ------------------------------------------------------------ Years
  function buildYears(state, result, year) {
    var years = Object.keys(result.cohorts).sort().reverse();
    if (!years.length) return '<div class="empty-note">No purchases yet.</div>';
    if (year !== 'all' && !result.cohorts[year]) year = 'all';
    var all = year === 'all';
    var v = all ? result.buysAll : result.cohorts[year], j = all ? result.journeys.buysAll : result.journeys[year];
    var divs = false;
    var h = '<div class="section scroll-x">' + seg('year', [{ v: 'all', l: 'All' }].concat(years.map(function (y) { return { v: y, l: y }; })), year) + '</div>';
    if (all) {
      // "All" is the same headline as Overview: the whole account,
      // time-weighted. The buy-by-buy figure is shown beside it.
      h += heroBlock(result.diffPp >= 0 ? 'You beat buy-and-hold by' : 'Buy-and-hold beat you by', result.diffPp,
        'Your whole account, time-weighted, vs. the S&amp;P 500 with dividends reinvested — the same figure as Overview.',
        fmtDate(result.startDate) + ' – ' + fmtDate(result.endDate), result.diffPp < 0, twrCompare(twr(result)));
      h += '<div class="kpis">' +
        kpi('Your gain', result.actualGain, 'signed', b(fmtPct(result.actualPct)) + ' time-weighted') +
        kpi('Buy-and-hold S&amp;P 500', result.baselineGain, 'signed', b(fmtPct(result.baselinePct)) + ' time-weighted') +
        kpi('Difference', result.diff, 'signed', 'on ' + b(fmtMoney(result.moneyIn)) + ' of new money') +
        kpi('Total purchases', v.moneyIn, 'money', b(fmtMoney(v.newMoney)) + ' new · ' + b(fmtMoney(v.reinvested)) + ' reinvested') + '</div>';
    } else {
    h += heroBlock(v.diffPp >= 0 ? 'You beat buy-and-hold by' : 'Buy-and-hold beat you by', v.diffPp,
      (all ? 'Every purchase' : 'The purchases made in ' + year) + ', each followed from its buy date to its sale (or today if still held), vs. the same dollars in the S&amp;P 500 over the same dates.',
      plural(v.count, 'purchase') + ' · ' + fmtDate(v.from) + ' – ' + fmtDate(v.to), v.diffPp < 0, [
        { l: 'Your buys', v: fmtPct(v.actualPct), tone: v.actualPct },
        { l: 'S&amp;P 500, same dates', v: fmtPct(v.baselinePct), tone: v.baselinePct },
        { l: 'Difference', v: fmtSignedMoney0(v.diff), tone: v.diff }
      ].concat(divs && v.dividends > 0.5 ? [{ l: 'Dividends earned', v: fmtMoney(v.dividends) }] : []));
    h += '<div class="kpis">' +
      kpi('Your gain', v.actual, 'signed', b(fmtPct(v.actualPct)) + ' on those buys') +
      kpi('Buy-and-hold S&amp;P 500', v.baseline, 'signed', b(fmtPct(v.baselinePct)) + ' on those buys') +
      kpi('Difference', v.diff, 'signed', 'on ' + b(fmtMoney(v.moneyIn)) + ' invested in ' + (all ? 'all buys' : year + ' buys')) +
      kpi('Total purchases', v.moneyIn, 'money', b(fmtMoney(v.newMoney)) + ' new · ' + b(fmtMoney(v.reinvested)) + ' reinvested') + '</div>';
    }
    h += '<section class="section card pad" style="margin-top:22px"><div class="section-head"><h2>Follow the money</h2><span class="hint">money in → ' + (all ? 'purchases' : year + ' purchases') + ' → sales → where the proceeds went</span></div><div class="steps">' +
      step(1, range(j.arrivalsRange), j.arrivals.length ? '<strong>' + fmtMoney(j.arrivalsTotal) + '</strong> of new money came in' + (all ? '' : ' during ' + year) + ' (' +
        uniq(j.arrivals.map(function (a) { return arrivalLabel(a.type).toLowerCase(); })).join(', ') + ').' : 'No new money came in' + (all ? '.' : ' during ' + year + '.'),
        moreTable('See the ' + plural(j.arrivals.length, 'deposit'), [C.date, { h: 'Type', f: function (a) { return arrivalLabel(a.type); } }, C.amt], j.arrivals)) +
      step(2, range(j.buysRange), '<strong>' + fmtMoney(j.buysTotal) + '</strong> went into ' + plural(j.buys.length, 'purchase') + (all ? '' : ' made in ' + year) +
        ', paid for with <strong>' + fmtMoney(v.newMoney) + '</strong> of new money and <strong>' + fmtMoney(v.reinvested) + '</strong> from earlier sales and dividends.',
        moreTable('See the ' + plural(j.buys.length, 'purchase'), [C.date, C.sym, C.amt,
          { h: 'New money', num: true, f: function (x) { return fmtMoney(x.newMoney); } },
          { h: 'From sales', num: true, f: function (x) { return fmtMoney(x.reinvested); } }, C.gain], j.buys)) +
      step(3, range(j.salesRange), (j.sales.length ? 'They were sold in ' + plural(j.sales.length, 'sale') + ' for <strong>' + fmtMoney(j.salesTotal) +
        '</strong>, a gain of <strong class="' + cls(j.salesGain) + '">' + fmtSignedMoney0(j.salesGain) + '</strong> on the shares sold.' : 'None of them have been sold.') +
        (j.heldCount ? ' Shares still held are worth <strong>' + fmtMoney(j.heldValue) + '</strong> at ' + fmtDate(result.endDate) + '.' : ''),
        moreTable('See the ' + plural(j.sales.length, 'sale'), [C.date, { h: 'Symbol', f: function (s) { return esc(s.symbol) + ' · ' + fmtShares(s.shares) + ' sh'; } },
          { h: 'Proceeds', num: true, f: function (s) { return fmtMoney(s.proceeds); } }, C.gain], j.sales)) +
      step(4, range(j.laterRange), j.later.length ? 'The proceeds then paid for <strong>' + fmtMoney(j.laterTotal) + '</strong> of ' + plural(j.later.length, 'later purchase') +
        ', which gained <strong class="' + cls(j.laterGain) + '">' + fmtSignedMoney0(j.laterGain) + '</strong>' +
        (all ? ' — those purchases are part of the totals above.' : ' — those count in the year each was bought.') :
        'No sale proceeds have gone into later purchases yet.', moreTable('See where the proceeds went', [C.date, C.sym, C.amt, C.gain], j.later)) +
      step(5, fmtDate(v.to), (all ? 'Judged buy by buy: ' : '') + 'Total <strong class="' + cls(v.actual) + '">' + fmtSignedMoney0(v.actual) + ' (' + fmtPct(v.actualPct) + ')</strong> vs. the S&amp;P 500 over the same dates <strong class="' +
        cls(v.baseline) + '">' + fmtSignedMoney0(v.baseline) + ' (' + fmtPct(v.baselinePct) + ')</strong> — difference <strong class="' + cls(v.diff) + '">' +
        fmtSignedMoney0(v.diff) + ' · ' + fmtPp(v.diffPp) + '</strong>.') + '</div></section>';
    var lots = all ? result.purchases : (result.purchasesByYear[year] || []);
    var vc = verdictCounts(lots);
    var byPp = lots.slice().sort(function (a, c) { return c.pp - a.pp; });
    var maxPp = lots.reduce(function (m, l) { return Math.max(m, Math.abs(l.pp)); }, 0);
    h += '<section class="section"><div class="section-head"><h2>' + (all ? 'All purchases' : 'Purchases made in ' + year) + '</h2><div class="right"><a class="btn" href="#/purchases' + (all ? '' : '/' + year) + '">See all ' + lots.length + ' ' + icon('arrow') + '</a></div></div>' +
      beatSummary(vc, lots.length) +
      rail('Beat the index', byPp.filter(function (l) { return l.pp > 0.5; }).slice(0, 12), state, maxPp) +
      rail('In line', byPp.filter(function (l) { return l.pp >= -0.5 && l.pp <= 0.5; }), state, maxPp) +
      rail('Lagged the index', byPp.filter(function (l) { return l.pp < -0.5; }).reverse().slice(0, 12), state, maxPp) +
      '</section>';
    return h;
  }

  // Horizontal, scrollable row of purchase cards with arrow buttons.
  function rail(title, lots, state, maxPp) {
    if (!lots.length) return '';
    return '<div class="rail-head"><h2>' + title + ' <span class="muted">' + lots.length + '</span></h2>' +
      '<div class="rail-nav"><button type="button" class="btn icon-btn" data-rail="-1" aria-label="Scroll left">‹</button><button type="button" class="btn icon-btn" data-rail="1" aria-label="Scroll right">›</button></div></div>' +
      '<div class="rail">' + lots.map(function (l, i) { return pcard(l, state, Math.min(i, 8), maxPp); }).join('') + '</div>';
  }

  // ------------------------------------------------------------ Purchases
  function verdictCounts(lots) {
    var o = { beat: 0, inline: 0, lagged: 0, sold: 0, partly: 0, held: 0 };
    lots.forEach(function (l) {
      if (l.pp > 0.5) o.beat++; else if (l.pp < -0.5) o.lagged++; else o.inline++;
      o[l.status]++;
    });
    return o;
  }
  function beatSummary(vc, total) {
    if (!total) return '';
    function w(n) { return (n / total * 100).toFixed(1); }
    return '<div class="beat-summary"><strong>' + vc.beat + ' of ' + total + ' beat the index</strong><div class="beatbar"><span class="b" style="width:' + w(vc.beat) +
      '%"></span><span class="i" style="width:' + w(vc.inline) + '%"></span><span class="l" style="width:' + w(vc.lagged) + '%"></span></div>' +
      '<span class="muted mono" style="font-size:12px">' + vc.inline + ' in line · ' + vc.lagged + ' lagged</span></div>';
  }
  function lotId(l) { return l.symbol + '|' + l.buyDate; }
  function pcard(l, state, i, maxPp) {
    maxPp = maxPp || 50;
    var w = Math.max(Math.abs(l.pp) <= 0.5 ? 1.5 : 0, Math.min(50, Math.abs(l.pp) / maxPp * 50));
    var vc = vcls(l.pp);
    var last = l.soldPieces.length ? l.soldPieces[l.soldPieces.length - 1] : null;
    var exit = l.status === 'sold' ? 'Sold ' + fmtDate(last.date) : (l.status === 'partly' ? 'Part sold' : 'Held');
    return '<button type="button" class="card pcard" style="--i:' + (i || 0) + '" data-lot="' + esc(lotId(l)) + '">' +
      '<div class="pcard-top"><span class="pcard-sym">' + esc(l.symbol) + '</span><span class="pcard-date">' + fmtDate(l.buyDate) + '</span>' +
      '<span class="status ' + l.status + '">' + { sold: 'Sold', partly: 'Part sold', held: 'Held' }[l.status] + '</span></div>' +
      '<div class="pcard-row"><div><div class="eyebrow">vs S&amp;P 500' + (vc === 'flat' ? ' · in line' : '') + '</div><div class="pcard-pp ' + vc + '">' + fmtPp(l.pp) + '</div></div>' +
      '<div class="pcard-gain ' + cls(l.totalGain) + '"><small>YOUR GAIN</small>' + fmtSignedMoney0(l.totalGain) + '</div></div>' +
      '<div class="cbar"><span class="' + (vc === 'flat' ? 'flat' : cls(l.pp)) + '" style="' + (l.pp >= 0 ? 'left:50%' : 'right:50%') + ';width:' + w.toFixed(1) + '%"></span></div>' +
      '<div class="pcard-foot">' + fmtMoney(l.cost) + ' in · ' + exit + '</div></button>';
  }
  var DEFAULT_UI = { ssort: 'extra', year: 'all', verdict: 'all', status: 'all', symbol: 'all', sort: 'beat', mode: 'cards', chart: 'dollars', acct: '', sp: true, divs: false };
  var SORTS = [['beat', 'Biggest beat first'], ['lag', 'Biggest lag first'], ['newest', 'Newest first'], ['oldest', 'Oldest first'],
    ['gain', 'Largest gain'], ['invested', 'Largest invested']];
  function filterLots(lots, ui) {
    return lots.filter(function (l) {
      if (ui.verdict === 'beat' && !(l.pp > 0.5)) return false;
      if (ui.verdict === 'inline' && !(l.pp >= -0.5 && l.pp <= 0.5)) return false;
      if (ui.verdict === 'lagged' && !(l.pp < -0.5)) return false;
      if (ui.status === 'sold' && l.status !== 'sold') return false;
      if (ui.status === 'held' && l.status === 'sold') return false;
      if (ui.symbol !== 'all' && l.symbol !== ui.symbol) return false;
      return true;
    });
  }
  function sortLots(lots, s) {
    var f = {
      lag: function (a, b) { return a.pp - b.pp; }, newest: function (a, b) { return a.buyDate < b.buyDate ? 1 : -1; },
      oldest: function (a, b) { return a.buyDate < b.buyDate ? -1 : 1; }, gain: function (a, b) { return b.totalGain - a.totalGain; },
      invested: function (a, b) { return b.cost - a.cost; }, beat: function (a, b) { return b.pp - a.pp; }
    }[s] || function (a, b) { return b.pp - a.pp; };
    return lots.slice().sort(f);
  }
  function pill(kind, v, label, cur) {
    return '<button type="button" class="pill' + (cur === v ? ' active' : '') + '" data-kind="' + kind + '" data-val="' + v + '">' + label + '</button>';
  }
  function buildPurchases(state, result) {
    var ui = state.ui;
    var all = ui.year === 'all' ? result.purchases : (result.purchasesByYear[ui.year] || []);
    var years = Object.keys(result.purchasesByYear).sort().reverse();
    var syms = []; all.forEach(function (l) { if (syms.indexOf(l.symbol) === -1) syms.push(l.symbol); }); syms.sort();
    var agg = { cost: 0, gain: 0, idx: 0 };
    all.forEach(function (l) { agg.cost += l.cost; agg.gain += l.totalGain; agg.idx += l.indexGain; });
    var dw = agg.cost ? (agg.gain - agg.idx) / agg.cost * 100 : 0;
    var vc = verdictCounts(all);
    var h = '<div class="toolbar"><div class="scroll-x">' + seg('pyear', [{ v: 'all', l: 'All years' }].concat(years.map(function (y) { return { v: y, l: y }; })), ui.year) + '</div>' +
      '</div>' +
      '<div class="toolbar">' + seg('mode', [{ v: 'cards', l: 'Every purchase' }, { v: 'stocks', l: 'By stock' }], ui.mode) +
      '</div>' +
      '<div class="math card"><div><div class="eyebrow">Your gain</div><div class="m-v ' + cls(agg.gain) + '">' + fmtSignedMoney0(agg.gain) + '</div></div>' +
      '<div class="op">−</div><div><div class="eyebrow">S&amp;P 500, same dates</div><div class="m-v ' + cls(agg.idx) + '">' + fmtSignedMoney0(agg.idx) + '</div></div>' +
      '<div class="op">=</div><div><div class="eyebrow">Extra vs the index</div><div class="m-v ' + cls(agg.gain - agg.idx) + '">' + fmtSignedMoney0(agg.gain - agg.idx) + '</div></div>' +
      '<div class="op">÷</div><div><div class="eyebrow">Invested in these buys</div><div class="m-v">' + fmtMoney(agg.cost) + '</div></div>' +
      '<div class="op">=</div><div><div class="eyebrow">Ahead of the index</div><div class="m-v ' + cls(dw) + '">' + fmtPp(dw) + '</div></div></div>';
    if (ui.mode === 'stocks') return h + '<div class="toolbar"><span class="muted" style="font-size:14px">' + plural(Object.keys(all.reduce(function (o, l) { o[l.symbol] = 1; return o; }, {})).length, 'stock') +
      ' · tap one to see its purchases</span><select class="select" data-ctl="ssort" aria-label="Sort stocks" style="margin-left:auto">' +
      SSORTS.map(function (x) { return '<option value="' + x[0] + '"' + (ui.ssort === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div>' + buildStocks(all, ui.ssort);
    h += beatSummary(vc, all.length);
    h += '<div class="toolbar">' + pill('verdict', 'all', 'All ' + all.length, ui.verdict) + pill('verdict', 'beat', 'Beat ' + vc.beat, ui.verdict) +
      pill('verdict', 'inline', 'In line ' + vc.inline, ui.verdict) + pill('verdict', 'lagged', 'Lagged ' + vc.lagged, ui.verdict) + '<span class="sep"></span>' +
      pill('status', 'all', 'Sold + held', ui.status) + pill('status', 'sold', 'Sold', ui.status) + pill('status', 'held', 'Still held', ui.status) + '<span class="sep"></span>' +
      '<select class="select" data-ctl="symbol" aria-label="Stock"><option value="all">All stocks</option>' +
      syms.map(function (s) { return '<option' + (ui.symbol === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select>' +
      '<select class="select" data-ctl="sort" aria-label="Sort">' + SORTS.map(function (s) { return '<option value="' + s[0] + '"' + (ui.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></div>';
    var shown = sortLots(filterLots(all, ui), ui.sort);
    var maxPp = all.reduce(function (m, l) { return Math.max(m, Math.abs(l.pp)); }, 0);
    h += '<div class="muted mono" style="font-size:12px;margin-bottom:10px">Showing ' + shown.length + ' of ' + all.length + ' · tap a purchase for details</div>';
    if (!shown.length) return h + '<div class="card empty-note">No purchases match these filters.</div>';
    return h + '<div class="cards">' + shown.map(function (l, i) { return pcard(l, state, Math.min(i, 20), maxPp); }).join('') + '</div>';
  }
  var SSORTS = [['extra', 'Most extra vs index'], ['pp', 'Biggest beat (pp)'], ['lag', 'Biggest lag first'], ['invested', 'Most invested'], ['az', 'A → Z']];
  function buildStocks(lots, sortId) {
    var by = {};
    lots.forEach(function (l) {
      var b = by[l.symbol] || (by[l.symbol] = { inv: 0, gain: 0, idx: 0, n: 0, beat: 0, nw: 0, rv: 0 });
      b.inv += l.cost; b.gain += l.totalGain; b.idx += l.indexGain; b.n++; b.nw += l.fundingNew; b.rv += l.fundingReinvested;
      if (l.pp > 0.5) b.beat++;
    });
    function pp(s) { var x = by[s]; return x.inv ? (x.gain - x.idx) / x.inv * 100 : 0; }
    var order = {
      extra: function (a, c) { return (by[c].gain - by[c].idx) - (by[a].gain - by[a].idx); },
      pp: function (a, c) { return pp(c) - pp(a); }, lag: function (a, c) { return pp(a) - pp(c); },
      invested: function (a, c) { return by[c].inv - by[a].inv; }, az: function (a, c) { return a < c ? -1 : 1; }
    }[sortId || 'extra'] || function (a, c) { return (by[c].gain - by[c].idx) - (by[a].gain - by[a].idx); };
    var syms = Object.keys(by).sort(order);
    if (!syms.length) return '<div class="card empty-note">No purchases.</div>';
    return '<div class="stock-list">' + syms.map(function (s, i) {
      var b = by[s], pp = b.inv ? (b.gain - b.idx) / b.inv * 100 : 0;
      return '<button type="button" class="card stock" style="--i:' + i + '" data-stock="' + esc(s) + '">' +
        '<div class="stock-top"><span class="stock-sym">' + esc(s) + '</span><span class="stock-beat">' + b.beat + ' of ' + plural(b.n, 'buy') + ' beat</span>' +
        '<span class="stock-pp ' + vcls(pp) + '">' + fmtPp(pp) + '</span></div>' +
        '<div class="stock-grid"><div><span>Invested</span><b>' + fmtMoney(b.inv) + '</b></div><div><span>Your gain</span><b class="' + cls(b.gain) + '">' + fmtSignedMoney0(b.gain) + '</b></div>' +
        '<div><span>S&amp;P 500</span><b class="' + cls(b.idx) + '">' + fmtSignedMoney0(b.idx) + '</b></div><div><span>Extra</span><b class="' + cls(b.gain - b.idx) + '">' + fmtSignedMoney0(b.gain - b.idx) + '</b></div></div>' +
        '<div class="stock-line">' + fmtMoney(b.nw) + ' new money · ' + fmtMoney(b.rv) + ' reinvested</div></button>';
    }).join('') + '</div>';
  }
  function buildLotDetail(l, result, showDivs) {
    var last = l.soldPieces.length ? l.soldPieces[l.soldPieces.length - 1] : null;
    var vcl = vcls(l.pp);
    var h = '<div class="hero' + (vcl === 'neg' ? ' behind' : vcl === 'flat' ? ' flat' : '') + '" style="padding:20px 22px"><div class="hero-label">vs S&amp;P 500' + (vcl === 'flat' ? ' · in line' : '') + '</div>' +
      '<div class="hero-value ' + vcl + '" style="font-size:52px">' + fmtPp(l.pp) + '</div><div class="hero-sub">You ' + fmtPct(l.youPct * 100) +
      ' · S&amp;P 500 ' + fmtPct(l.indexPct * 100) + ' over the same dates</div></div>';
    h += '<dl class="kv"><dt>Your gain</dt><dd class="' + cls(l.totalGain) + '">' + fmtMoney2(l.totalGain) + '</dd>' +
      '<dt>Same dollars in the S&amp;P 500</dt><dd class="' + cls(l.indexGain) + '">' + fmtMoney2(l.indexGain) + '</dd>' +
      '<dt>Extra vs the index</dt><dd class="' + cls(l.extra) + '">' + fmtMoney2(l.extra) + '</dd>' +
      '<dt>Bought</dt><dd>' + fmtShares(l.shares) + ' sh @ $' + l.buyPrice.toFixed(2) + '</dd>' +
      '<dt>Invested</dt><dd>' + fmtMoney(l.cost) + '</dd><dt>Paid with</dt><dd>' + fmtMoney(l.fundingNew) + ' new · ' + fmtMoney(l.fundingReinvested) + ' reinvested</dd>' +
      (l.dividendsTotal > 0.005 ? '<dt>Dividends while held</dt><dd>' + fmtMoney2(l.dividendsTotal) + (l.dripShares > 0.0005 ? ' (+' + fmtShares(l.dripShares) + ' sh reinvested)' : '') + '</dd>' : '') +
      '<dt>' + (l.status === 'sold' ? 'Sold' : 'Status') + '</dt><dd>' + (l.status === 'sold' ? fmtDate(last.date) : (l.status === 'partly' ? 'Partly sold' : 'Still held')) + '</dd></dl>';
    h += '<h3 style="font:700 17px var(--serif);margin:22px 0 4px">How this buy was ' + (l.soldPieces.length ? 'sold' : 'valued') + '</h3>';
    h += '<div class="table-wrap"><table class="t"><tr><th>Piece</th><th class="num">Gain</th><th class="num">vs S&amp;P</th></tr>' +
      l.pieces.map(function (p) {
        var pp = (p.gainPct - p.indexPct) * 100;
        return '<tr><td>' + fmtShares(p.shares) + ' sh ' + (p.held ? 'still held @ $' + p.exitPrice.toFixed(2) + ' (' + fmtDateShort(p.exitDate) + ')' :
          'sold ' + fmtDate(p.exitDate) + ' @ $' + p.exitPrice.toFixed(2)) + '</td><td class="num ' + cls(p.gain) + '">' + fmtMoney2(p.gain) +
          '</td><td class="num ' + cls(pp) + '">' + fmtPp(pp) + '</td></tr>';
      }).join('') + '</table></div>';
    return h;
  }

  // ------------------------------------------------------------ Portfolio
  // Account list for the Portfolio page. Each Fidelity account found in your
  // uploads is calculated from its own transactions (daily time-weighted
  // returns chained into months; S&P 500 total return over the same days).
  // Sheet columns fill in accounts with no Fidelity files (e.g. a 401k).
  var TYPES = ['Roth IRA', 'Traditional IRA', 'Brokerage', 'Roth 401k', '401k', 'HSA', 'Other'];
  function pfAccounts(state, results) {
    var out = [], covered = {};
    var pf = state.portfolio;
    Object.keys(results || {}).sort().forEach(function (id) {
      var res = results[id], meta = (state.accounts || {})[id] || { name: 'Fidelity account', type: 'Other' };
      if (!res) return;
      var mr = E.monthlyReturns(res);
      if (!mr.length) return;
      var acc = { key: 'fid:' + id, label: meta.name, type: meta.type, source: 'fidelity', id: id,
        rows: mr.map(function (m) { return [m[0], m[1]]; }), sp: mr.map(function (m) { return [m[0], m[2]]; }),
        partial: mr[mr.length - 1][3] < lastDayOfMonth(mr[mr.length - 1][3]) };
      if (pf) P.ACCOUNTS.forEach(function (a) {
        if (a.type !== meta.type || covered[a.id] || !(pf.accounts[a.id] || []).length) return;
        covered[a.id] = 1;
        var sheetMap = {}; pf.accounts[a.id].forEach(function (r) { sheetMap[r[0]] = r[1]; });
        var both = acc.rows.filter(function (r) { return sheetMap[r[0]] !== undefined; });
        if (both.length) {
          var calc = both.reduce(function (p, r) { return p * (1 + r[1] / 100); }, 1) - 1;
          var sh = both.reduce(function (p, r) { return p * (1 + sheetMap[r[0]] / 100); }, 1) - 1;
          acc.sheetCheck = { label: a.label, months: both.length, from: both[0][0], to: both[both.length - 1][0], calc: calc * 100, sheet: sh * 100 };
        }
      });
      out.push(acc);
    });
    if (pf) P.ACCOUNTS.forEach(function (a) {
      if (covered[a.id] || !(pf.accounts[a.id] || []).length) return;
      out.push({ key: 'sheet:' + a.id, label: a.label, type: a.type, source: 'sheet', rows: pf.accounts[a.id], sp: pf.sp });
    });
    return out;
  }
  function lastDayOfMonth(iso) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7);
    return iso.slice(0, 8) + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
  }
  // The Portfolio page follows the global account picker (state.account).
  // Accounts that exist only in an imported sheet are extra picker entries
  // on this page; choosing one sets state.ui.acct to its 'sheet:' key.
  function pickPf(state, list) {
    var want = String(state.ui.acct || '').indexOf('sheet:') === 0 ? state.ui.acct : null;
    function find(k) { return k ? list.filter(function (a) { return a.key === k; })[0] : null; }
    return find(want) || find('fid:' + state.account) || list[0];
  }
  function buildPortfolio(state, list) {
    list = list || [];
    if (!list.length) return '<div class="card pad empty-note">Nothing to show yet. <a href="#/data">Upload Fidelity files or your sheet on Data</a>.</div>';
    var acc = pickPf(state, list), showSp = state.ui.sp;
    var m = P.metrics(acc.rows, acc.sp), label = esc(acc.label);
    var h = '<div class="toolbar"><label class="toggle" style="margin-left:auto"><input type="checkbox" data-ctl="sp"' + (showSp ? ' checked' : '') + '><span class="track"></span>Compare with S&amp;P 500</label></div>';
    h += '<div class="source ' + acc.source + '"><span class="badge-src">' + (acc.source === 'fidelity' ? 'Calculated from your Fidelity files' : 'From your sheet') + '</span>' +
      '<span>' + esc(acc.type) + (acc.source === 'fidelity' ? ' · account ··' + esc(String(acc.id).slice(-4)) + ' · daily time-weighted returns chained into months' + (acc.partial ? ' · latest month to date' : '') :
        ' · monthly returns as entered in ' + esc((state.portfolio || {}).source || 'your sheet')) + '</span></div>';
    if (acc.sheetCheck && Math.abs(acc.sheetCheck.sheet - acc.sheetCheck.calc) > 1) {
      var sc = acc.sheetCheck;
      h += '<div class="note">Your sheet’s ' + esc(sc.label) + ' column over the same ' + sc.months + ' months (' + sc.from + ' – ' + sc.to + '): <b>' + fmtPct(sc.sheet) +
        '</b>. Calculated from your files: <b>' + fmtPct(sc.calc) + '</b>.' + (Math.abs(sc.sheet - sc.calc) > 1 ? ' They differ by ' + fmtPp(sc.calc - sc.sheet) + ' — the files count every deposit and dividend on the day it happened, so check the sheet for those months.' : '') + '</div>';
    }
    if (!m) return h + '<div class="card empty-note">No months for this account.</div>';
    h += '<div class="stats6">' +
      kpi('Total return', m.total, 'pct', b(m.months + ' months') + ' · ' + m.from + ' – ' + m.to) +
      kpi('Per year', m.annual, 'pct', 'annualized') +
      (showSp ? kpi('vs S&amp;P 500', m.vsSp, 'pp', 'S&amp;P ' + b(fmtPct(m.spTotal))) : '<div class="card kpi neu"><div class="eyebrow">Growth of $1</div><div class="kpi-value">' + m.nav.toFixed(3) + '×</div><div class="kpi-sub">at ' + m.to + '</div></div>') +
      '<div class="card kpi neu"><div class="eyebrow">Win rate</div><div class="kpi-value">' + m.winRate.toFixed(0) + '%</div><div class="kpi-sub">' + b(m.wins + '/' + m.months) + ' months up</div></div>' +
      kpi('Best month', m.best, 'pct', m.bestM) + kpi('Worst month', m.worst, 'pct', m.worstM) + '</div>';
    h += '<div class="stats4">' +
      '<div class="card kpi pos"><div class="eyebrow">All-time high</div><div class="kpi-value">' + m.peak.toFixed(3) + '×</div><div class="kpi-sub">' + esc(m.peakM) + '</div></div>' +
      kpi('Worst drawdown', m.maxDrawdown, 'pct', 'peak ' + esc(m.ddFrom) + ' → low ' + esc(m.ddTo || '—'), 'neg') +
      kpi('Best run', m.bestRun, 'pct', esc(m.bestRunFrom) + ' → ' + esc(m.bestRunTo || '—'), 'pos') +
      (showSp ? '<div class="card kpi neu"><div class="eyebrow">Months beating S&amp;P</div><div class="kpi-value">' + m.beatMonths + '/' + m.spMonths + '</div><div class="kpi-sub">S&amp;P ' +
        b(fmtPct(m.spAnnual)) + ' per year</div></div>' : '<div class="card kpi neu"><div class="eyebrow">Lowest point</div><div class="kpi-value">' + m.low.toFixed(3) + '×</div><div class="kpi-sub">' + esc(m.lowM) + '</div></div>') +
      '</div>';
    h += '<section class="section card pad" style="margin-top:18px"><div class="section-head"><h2>Cumulative growth</h2><span class="hint">' + label + (showSp ? ' vs S&amp;P 500' : '') + '</span>' +
      '<div class="right legend"><span><i style="background:#c45c0c"></i>' + label + '</span>' + (showSp ? '<span><i class="dash"></i>S&amp;P 500</span>' : '') + '</div></div>' +
      '<div class="chart" id="pfLine"></div></section>';
    h += '<section class="section card pad"><div class="section-head"><h2>Monthly returns</h2><div class="right legend"><span><i style="background:#2d7a45"></i>Up</span><span><i style="background:#b03030"></i>Down</span>' +
      (showSp ? '<span><i style="background:#c8ae82"></i>S&amp;P 500</span>' : '') + '</div></div><div class="chart" id="pfBars"></div>' +
      '<details class="more block" open><summary>Monthly detail</summary><div class="more-body"><div class="table-wrap"><table class="t"><tr><th>Month</th><th class="num">' + label + '</th>' +
      (showSp ? '<th class="num">S&amp;P 500</th><th class="num">Difference</th>' : '') + '<th class="num">Growth of $1</th></tr>' +
      m.data.slice().reverse().map(function (d) {
        return '<tr><td>' + d.m + '</td><td class="num ' + cls(d.p) + '">' + fmtPct(d.p) + '</td>' +
          (showSp ? '<td class="num ' + (d.b == null ? '' : cls(d.b)) + '">' + (d.b == null ? '—' : fmtPct(d.b)) + '</td><td class="num ' + (d.b == null ? '' : cls(d.p - d.b)) + '">' +
            (d.b == null ? '—' : fmtPp(d.p - d.b)) + '</td>' : '') + '<td class="num">' + d.nav.toFixed(3) + '×</td></tr>';
      }).join('') + '</table></div><p class="muted" style="font-size:13px;margin-top:10px">S&amp;P 500: ' +
      (acc.source === 'fidelity' ? 'total-return index (^SP500TR from Yahoo Finance, dividends reinvested), month-end to month-end over the same days as your account' +
        (acc.partial ? '; the latest month runs to the latest close' : '') + '.' : 'the S&amp;P 500 column from your sheet, as entered.') + '</p></div></details></section>';
    h += '<section class="section card pad prose"><div class="section-head"><h2>How this page is calculated</h2></div>' +
      '<p><strong>Accounts from your Fidelity files</strong> are calculated here, not typed in: the account is rebuilt day by day from its transactions, each day’s return is today’s value ÷ (yesterday’s value + money that arrived that day) − 1, and the days in each month are multiplied together. The S&amp;P 500 line is the total-return index over the same days. Each Fidelity file is matched to its account by the account number in the file name (History_for_Account_<b>number</b>…), and the account type is guessed from what happens in it (Roth conversions or IRA contributions → Roth IRA) — you can rename it or change the type on the Data page.</p>' +
      '<p><strong>Accounts from your sheet</strong> (optional) use the monthly returns exactly as entered. They appear in the account picker only after you import a sheet on the Data page. When a Fidelity account has the same type as a sheet column, the calculated version is shown and the sheet is used only as a cross-check.</p>' +
      '<p>For every account, the stats compound the monthly returns from 1.0: total return, per year (annualized), win rate, the worst drawdown from a peak to the low after it, and the best run from a low to the high after it.</p></section>';
    return h;
  }

  // ---- News & Market: economy outlook, Fear & Greed, move-together, tone history
  function pctS(x, d) { return (x < 0 ? '−' : '+') + Math.abs(x * 100).toFixed(d === undefined ? 0 : d) + '%'; }
  function pct0(x) { return Math.round(x * 100) + '%'; }
  function newsSummary(state, result, now) {
    var raw = state.news;
    var hold = result ? Object.keys(result.holdings || {}).sort() : [];
    if (!raw || !raw.symbols) return null;
    var hv = 0;
    hold.forEach(function (s) { var x = result.holdings[s]; hv += Math.max(0, x.shares * x.price); });
    var rows = hold.map(function (s) {
      var a = N.analyzeSymbol(raw.symbols[s] || { symbol: s, items: [] }, now), x = result.holdings[s];
      a.weight = hv > 0 ? Math.max(0, x.shares * x.price) / hv : 0;
      return a;
    });
    var withNews = rows.filter(function (r) { return r.count > 0; });
    var wsum = withNews.reduce(function (s, r) { return s + r.weight; }, 0);
    var port = wsum > 0 ? withNews.reduce(function (s, r) { return s + r.weight * r.score; }, 0) / wsum : 0;
    return { rows: rows, withNews: withNews, port: port, hold: hold, mkt: N.analyzeMarket((raw.market || {}).items || [], now) };
  }
  function buildOutlook(state) {
    var rows = state.indexRows || [], rt = state.regimeTable, mk = state.market || {};
    if (!rows.length || !rt) return '';
    var reg = EC.marketRegime(rows, mk.macro || null);
    if (!reg) return '';
    var keys = reg.haveMacro ? [reg.key, 'all'] : [(reg.trendDown ? 'down' : 'up') + '-clear', (reg.trendDown ? 'down' : 'up') + '-warn'];
    var cols = keys.map(function (k) { return { key: k, t: rt.table[k] }; });
    var colName = function (k) {
      return k === 'all' ? 'All months since 1960' : ({ 'up-clear': 'Uptrend, no warnings', 'up-warn': 'Uptrend + warnings', 'down-clear': 'Downtrend, no warnings', 'down-warn': 'Downtrend + warnings' })[k];
    };
    var ch = reg.checks;
    function light(on, name, val, trig) {
      var st = on === undefined ? 'unk' : on ? 'on' : 'off';
      return '<div class="light ' + st + '"><span class="ldot"></span><div><div class="l-name">' + name + '</div><div class="l-val">' + val + '</div><div class="l-trig">' + trig + '</div></div></div>';
    }
    var h = '<section class="section card pad outlook"><div class="section-head"><h2>Economy &amp; market outlook</h2><span class="hint">historical odds for what the S&amp;P 500 does next</span></div>';
    h += '<div class="regime ' + (reg.key === 'down-warn' ? 'neg' : reg.trendDown || reg.warnings.length ? 'flat' : 'pos') + '"><div class="eyebrow">Today’s situation</div><div class="regime-label">' +
      (reg.haveMacro ? reg.label : (reg.trendDown ? 'Market downtrend' : 'Market uptrend') + ' (economy data not loaded)') + '</div>' +
      '<div class="regime-sub">S&amp;P 500 is ' + pctS(reg.vsSma, 1) + ' vs. its 200-day average and ' + pctS(reg.fromHigh, 1) + ' from its 1-year high · ' + fmtDate(reg.asOf) + '</div></div>';
    h += outlookVerdict(reg, rt);
    h += '<div class="lights">' +
      light(reg.trendDown === undefined ? undefined : reg.trendDown, 'Trend', reg.trendDown ? 'Below 200-day average' : 'Above 200-day average', 'warns below the 200-day average') +
      light(ch.sahm ? ch.sahm.on : undefined, 'Unemployment (Sahm rule)', ch.sahm ? ch.sahm.value.toFixed(2) + ' · ' + monthName(ch.sahm.month) : 'not loaded', 'warns at 0.50 or higher') +
      light(ch.curve ? ch.curve.on : undefined, 'Yield curve (10-yr − 3-mo)', ch.curve ? (ch.curve.value >= 0 ? '+' : '−') + Math.abs(ch.curve.value).toFixed(2) + ' pts' + (ch.curve.invertedLast12 ? ' · inverted in the past year' : '') : 'not loaded', 'warns if inverted in the past 12 months') +
      light(ch.credit ? ch.credit.on : undefined, 'Credit spreads (Baa − 10-yr)', ch.credit ? ch.credit.value.toFixed(2) + ' pts · ' + (ch.credit.change6m >= 0 ? '+' : '−') + Math.abs(ch.credit.change6m).toFixed(2) + ' in 6 mo' : 'not loaded', 'warns at +0.50 in 6 months') +
      '</div>';
    if (!reg.haveMacro) h += '<div class="note">Economy data (FRED) didn’t load, so we can’t tell whether recession warnings are on. Both cases are shown. Press Refresh to try again.</div>';
    h += '<div class="table-wrap" style="max-height:none;margin-top:16px"><table class="t otable"><tr><th>Next…</th>' + cols.map(function (c) { return '<th colspan="3" class="grp">' + colName(c.key) + ' <span>(' + c.t.n + ' months)</span></th>'; }).join('') + '</tr>' +
      '<tr><th></th>' + cols.map(function () { return '<th class="num">Chance higher</th><th class="num">Chance of a further −10%</th><th class="num">Bad · typical · good result</th>'; }).join('') + '</tr>' +
      [1, 3, 6, 12].map(function (m) {
        return '<tr><td>' + (m === 1 ? '1 month' : m + ' months') + '</td>' + cols.map(function (c) {
          var x = c.t.h[String(m)];
          return '<td class="num"><b>' + pct0(x.pUp) + '</b></td><td class="num ' + (x.pDrop10 >= 0.25 ? 'neg' : '') + '"><b>' + pct0(x.pDrop10) + '</b></td>' +
            '<td class="num">' + pctS(x.p10) + ' · ' + pctS(x.median) + ' · ' + pctS(x.p90) + '</td>';
        }).join('') + '</tr>';
      }).join('') +
      '<tr><td>Recession within 12 months</td>' + cols.map(function (c) { return '<td class="num" colspan="3"><b class="' + (c.t.pRec12 >= 0.5 ? 'neg' : '') + '">' + pct0(c.t.pRec12) + '</b> of the time</td>'; }).join('') + '</tr>' +
      '</table></div>';
    var so = rt.selloffs;
    if (so) {
      h += '<div class="scen"><div><div class="eyebrow">If a recession comes</div><div class="scen-v neg">' + pctS(so.recession.medianDepth) + '</div><div class="scen-sub">typical S&amp;P selloff (worst ' + pctS(so.recession.worst) + '), about ' +
        Math.round(so.recession.medianMonths) + ' months to a new high · ' + so.recession.n + ' times since 1950</div></div>' +
        '<div><div class="eyebrow">If no recession comes</div><div class="scen-v flat">' + pctS(so.noRecession.medianDepth) + '</div><div class="scen-sub">typical selloff, about ' +
        Math.round(so.noRecession.medianMonths) + ' months to a new high · ' + so.noRecession.n + ' times since 1950</div></div></div>';
    }
    var wf = rt.walkForward && rt.walkForward['3'];
    h += '<p class="muted" style="font-size:13px;margin-top:14px">How to read it: in the ' + cols[0].t.n + ' past months that looked like ' + (reg.haveMacro ? 'today' : 'this') +
      ', the S&amp;P was higher 3 months later ' + pct0(cols[0].t.h['3'].pUp) + ' of the time. “Bad · typical · good” = 1-in-10 worst, middle and 1-in-10 best result. ' +
      (wf ? 'Tested month by month since 1975 using only earlier data, these odds warned of further 10% drops better than the long-run average (accuracy score ' + wf.brierDropRegime.toFixed(3) + ' vs ' + wf.brierDropBase.toFixed(3) + ', lower is better) and were only slightly better at calling up or down. ' : '') +
      'They’re odds from history, not a forecast. Economy data: FRED. Backtest built ' + esc(rt.built) + '.</p></section>';
    return h;
  }
  // One plain-English answer: does history lean up, down or flat from here?
  function outlookVerdict(reg, rt) {
    function lean(t) {
      var u3 = t.h['3'].pUp, d3 = t.h['3'].pDrop10, u12 = t.h['12'].pUp;
      if (u3 < 0.5 || d3 >= 0.25) return { cls: 'neg', word: 'Leaning down', short: 'more losses were common' };
      if (u3 >= 0.6 && u12 >= 0.7) return { cls: 'pos', word: 'Leaning up', short: 'the S&amp;P usually recovered' };
      return { cls: 'flat', word: 'Mixed — roughly a coin flip', short: 'no clear direction' };
    }
    function line(t) {
      return 'In the ' + t.n + ' past months like this, the S&amp;P was <b>higher 3 months later ' + pct0(t.h['3'].pUp) + '</b> of the time (typical ' + pctS(t.h['3'].median) +
        ') and <b>higher 12 months later ' + pct0(t.h['12'].pUp) + '</b> of the time (typical ' + pctS(t.h['12'].median) + '). A further 10% drop within 3 months happened ' + pct0(t.h['3'].pDrop10) + ' of the time.';
    }
    var dir = reg.trendDown ? 'down' : 'up';
    if (!reg.haveMacro) {
      var c = rt.table[dir + '-clear'], w = rt.table[dir + '-warn'], lc = lean(c), lw = lean(w);
      return '<div class="verdict flat"><div class="v-word">Depends on the economy data</div><div class="v-text">Without recession warnings history was <b>' + lc.word.toLowerCase() +
        '</b>; with them, <b>' + lw.word.toLowerCase() + '</b>. Press Refresh to load the economy data.</div></div>';
    }
    var cur = rt.table[reg.key], L = lean(cur);
    var alt = reg.warnings.length ? null : rt.table[dir + '-warn'];
    return '<div class="verdict ' + L.cls + '"><div class="eyebrow">What history says from here</div><div class="v-word">' + L.word + '</div><div class="v-text">' + line(cur) + '</div>' +
      (alt ? '<div class="v-flip"><b>What would change this:</b> if a recession warning turns on, past months like that were higher 3 months later only ' + pct0(alt.h['3'].pUp) +
        ' of the time, with a further 10% drop ' + pct0(alt.h['3'].pDrop10) + ' of the time. The three lights below are the ones to watch.</div>' :
        '<div class="v-flip"><b>Why:</b> recession warnings are on. In the past, downturns with a recession went much deeper (typical −27%) than those without (typical −10%).</div>') +
      '<div class="v-note">Historical odds, not a promise — any single year can go either way.</div></div>';
  }
  function monthName(ym) { var p = (ym || '').split('-'); return p.length >= 2 ? MON[+p[1] - 1] + ' ' + p[0] : ym; }
  function buildFearGreed(state) {
    var fg = (state.market || {}).fearGreed;
    if (!fg || fg.score == null) return '<div class="card pad mood"><div class="eyebrow">Fear &amp; Greed (CNN)</div><p class="muted" style="margin-top:8px">Not loaded — CNN’s feed may be unavailable. Press Refresh news to try again.</p></div>';
    var v = fg.score, lab = EC.fearGreedLabel(v);
    return '<div class="card pad mood"><div class="eyebrow">Fear &amp; Greed (CNN)</div><div class="mood-label ' + (v < 45 ? 'neg' : v > 55 ? 'pos' : 'flat') + '">' + Math.round(v) + ' · ' + lab + '</div>' +
      '<div class="gauge fg"><span class="g-mark ' + (v < 45 ? 'neg' : v > 55 ? 'pos' : 'flat') + '" style="left:' + v + '%"></span></div><div class="g-scale"><span>Extreme fear</span><span>Neutral</span><span>Extreme greed</span></div>' +
      '<p class="mood-sub">' + (fg.previousWeek != null ? 'A week ago ' + Math.round(fg.previousWeek) : '') + (fg.previousMonth != null ? ' · a month ago ' + Math.round(fg.previousMonth) : '') +
      '. Mood only: in backtests it didn’t improve forecasts.</p><div class="chart" id="fgChart" style="margin-top:8px"></div></div>';
  }
  function buildTogether(state, result) {
    if (!result) return '';
    var hold = Object.keys(result.holdings || {});
    var hv = 0, w = {};
    hold.forEach(function (s) { var x = result.holdings[s]; w[s] = Math.max(0, x.shares * x.price); hv += w[s]; });
    Object.keys(w).forEach(function (s) { w[s] = hv ? w[s] / hv : 0; });
    var have = hold.filter(function (s) { return (state.history[s] || []).length > 120; });
    var h = '<section class="section card pad"><div class="section-head"><h2>Holdings that move together</h2><span class="hint">daily moves over the last year</span></div>';
    if (have.length < 2) return h + '<p class="muted">Needs a year of daily prices for at least two holdings — press Refresh prices.</p></section>';
    var t = EC.together(state.history, have, w);
    if (!t.groups.length) h += '<p style="font-size:15px">None of your holdings move closely together (no pair above ' + t.threshold.toFixed(1) + ' correlation), so they behave like separate bets.</p>';
    t.groups.forEach(function (g) {
      h += '<div class="tg"><div class="tg-syms">' + g.members.map(esc).join(' · ') + '</div><div class="tg-sub">These rise and fall together (average correlation <b>' + g.avg.toFixed(2) + '</b>), so treat them as one bet — together <b>' +
        pct0(g.weight) + '</b> of your holdings.</div></div>';
    });
    h += moreTable('See every pair', [{ h: 'Pair', f: function (p) { return esc(p.a) + ' · ' + esc(p.b); } },
      { h: 'Correlation', num: true, f: function (p) { return p.c.toFixed(2); } },
      { h: 'Meaning', f: function (p) { return p.c >= 0.7 ? 'move together' : p.c >= 0.4 ? 'somewhat related' : 'mostly independent'; } }], t.pairs);
    h += '<p class="muted" style="font-size:13px;margin-top:10px">Correlation runs from −1 to +1: 1 means two stocks move exactly together. Index funds like FXAIX hold many of your stocks, so they correlate with them too.</p></section>';
    return h;
  }
  function buildToneHistory(state) {
    var hist = state.newsHistory || [];
    return '<section class="section card pad"><div class="section-head"><h2>News tone over time</h2><span class="hint">one reading per day you open this page</span></div>' +
      (hist.length >= 2 ? '<div class="legend"><span><i style="background:#c45c0c"></i>Your holdings</span><span><i class="dash"></i>Market</span></div><div class="chart" id="toneChart"></div>' :
        '<p class="muted">This builds up over time — ' + (hist.length ? 'first reading saved ' + fmtDate(hist[0].date) + '. ' : '') + 'come back on other days to see the trend.</p>') + '</section>';
  }

  // ---- Tested outlook model (many inputs, walk-forward)
  function skillTxt(s) { return (s >= 0 ? '+' : '−') + Math.abs(s * 100).toFixed(0) + '%'; }
  function buildModel(state) {
    var M = state.outlookModel, st = state.modelStatus;
    var h = '<section class="section card pad model"><div class="section-head"><h2>Does more data help? The tested model</h2>' +
      '<span class="hint">' + (M && M.results ? '11 groups of inputs · trained ' + esc(M.selection[0].slice(0, 4)) + '–' + esc(M.selection[1].slice(0, 4)) + ', tested on ' + esc(M.test[0].slice(0, 4)) + '–today' : 'economy, markets, policy, global, sentiment') + '</span>' +
      '<div class="right"><button class="btn" type="button" data-act="model"' + (st ? ' disabled' : '') + '>' + icon('refresh') + '<span class="lbl">' + (M ? 'Rebuild' : 'Build') + '</span></button></div></div>';
    if (st) return h + '<div class="note">' + esc(st) + '</div></section>';
    if (!M || !M.results) return h + '<p class="muted">Not built yet. It downloads about 70 years of economic and market history (FRED, Yahoo, Shiller) and tests every input — about a minute.</p></section>';
    var R = M.results, ids = ['up3', 'up12', 'drop10', 'rec12'].filter(function (k) { return R[k]; });
    var useful = ids.filter(function (k) { return R[k].useful; });
    var names = { up3: 'the S&amp;P 3 months out', up12: 'the S&amp;P 12 months out', drop10: 'a further 10% drop', rec12: 'recession risk' };
    h += '<div class="verdict ' + (useful.length ? 'pos' : 'flat') + '"><div class="eyebrow">Bottom line</div><div class="v-text">' +
      (useful.length ? 'On ' + esc(M.test[0].slice(0, 4)) + '–today — years the model never saw while choosing its inputs — it beat the long-run average for <b>' +
        useful.map(function (k) { return names[k]; }).join(', ') + '</b>. ' +
        (useful.length < ids.length ? 'For ' + ids.filter(function (k) { return !R[k].useful; }).map(function (k) { return names[k]; }).join(' and ') + ' it didn’t, so those show the long-run average. ' : '') :
        'On ' + esc(M.test[0].slice(0, 4)) + '–today — years the model never saw while choosing its inputs — <b>no combination of inputs beat the long-run average</b> for any of the four questions, so each shows the long-run average. Inputs that looked useful before 2000 stopped working after it' + (R.rec12 && R.rec12.chosen.indexOf('curve') >= 0 ? ' (the yield curve, for example, warned of a recession in 2022–24 that didn’t come)' : '') + '. That matches decades of research: short-term market direction is very hard to predict, and more inputs mostly add false confidence. ') +
      '</div></div>';
    h += '<div class="table-wrap" style="max-height:none;margin-top:14px"><table class="t"><tr><th>Question</th><th class="num">Odds now</th><th class="num">Long-run average</th><th>Tested on ' + esc(M.test[0].slice(0, 4)) + '–today</th><th>Inputs it uses</th></tr>' +
      ids.map(function (k) {
        var r = R[k], t = r.test;
        return '<tr><td>' + esc(r.q) + '</td><td class="num"><b>' + pct0(r.p) + '</b></td><td class="num">' + pct0(r.base) + '</td><td>' +
          (t ? (r.useful ? '<span class="pos"><b>Beat the average by ' + skillTxt(t.skill) + '</b></span>' : '<span class="muted">No better than the average' + (r.chosen.length ? ' (' + skillTxt(t.skill) + ')' : '') + '</span>') +
            ' · right ' + pct0(t.acc) + ' of the time vs ' + pct0(t.accBase) : '—') + '</td><td>' +
          (r.chosen.length ? r.chosen.map(function (g) { return esc(groupLabel(M, g)); }).join(', ') + (r.useful ? '' : ' <span class="muted">(dropped in testing)</span>') : '<span class="muted">none helped</span>') + '</td></tr>';
      }).join('') + '</table></div>';
    var drv = [];
    ids.forEach(function (k) { (R[k].drivers || []).forEach(function (d) { drv.push({ k: k, g: d.group, e: d.effect }); }); });
    if (drv.length) {
      h += '<div class="drivers"><div class="eyebrow" style="margin-bottom:6px">What’s moving the odds now</div>' + drv.map(function (d) {
        return '<div class="drv"><span>' + esc(groupLabel(M, d.g)) + ' → ' + names[d.k] + '</span><b class="' + (d.k === 'drop10' || d.k === 'rec12' ? (d.e > 0 ? 'neg' : 'pos') : cls(d.e)) + '">' + (d.e >= 0 ? '+' : '−') + Math.abs(d.e * 100).toFixed(0) + ' pts</b></div>';
      }).join('') + '</div>';
    }
    // Inputs and what happened to each.
    h += '<details class="more block" open><summary>Every input and how it tested</summary><div class="more-body"><div class="table-wrap" style="max-height:none"><table class="t"><tr><th>Input</th><th>Data</th>' +
      ids.map(function (k) { return '<th class="num">' + { up3: 'Higher 3 mo', up12: 'Higher 12 mo', drop10: '−10% drop', rec12: 'Recession' }[k] + '</th>'; }).join('') + '</tr>' +
      M.groups.map(function (g) {
        var c = M.coverage[g.id] || {}, testable = M.testable.indexOf(g.id) >= 0;
        var status = c.now > 0 ? (testable ? 'tested' : c.now < 0.99 ? 'only partly downloaded' : 'too little history before 2000 to test') : 'not downloaded';
        return '<tr><td><b>' + esc(g.label) + '</b><div class="muted" style="font-size:12px">' + esc(g.what) + '</div></td><td class="' + (status === 'tested' ? '' : 'muted') + '">' + status + '</td>' +
          ids.map(function (k) {
            if (!testable) return '<td class="num muted">—</td>';
            var s = R[k].solo[g.id], used = R[k].chosen.indexOf(g.id) >= 0;
            return '<td class="num ' + (s > 0.01 ? 'pos' : s < -0.01 ? 'neg' : 'muted') + '">' + (s == null ? '—' : skillTxt(s)) + (used ? ' ✓' : '') + '</td>';
          }).join('') + '</tr>';
      }).join('') + '</table></div><p class="muted" style="font-size:13px;margin-top:8px">Each number is how much that input alone improved the accuracy score over the long-run average on 1975–1999 (green helped, red hurt). ✓ = picked for the model, which was then judged on ' +
      esc(M.test[0].slice(0, 4)) + '–today.</p></div></details>';
    if (M.globalCheck && M.globalCheck.length) {
      h += '<details class="more block"><summary>Same market-trend rules on other countries</summary><div class="more-body"><div class="table-wrap" style="max-height:none"><table class="t"><tr><th>Market</th><th>Since</th><th class="num">Higher in 12 months</th><th class="num">Further −10% drop</th></tr>' +
        M.globalCheck.map(function (g) {
          function c(x) { return x ? '<span class="' + (x.skill > 0.01 ? 'pos' : x.skill < -0.01 ? 'neg' : 'muted') + '">' + skillTxt(x.skill) + '</span>' : '—'; }
          return '<tr><td>' + esc(g.name) + '</td><td>' + esc(g.from.slice(0, 4)) + '</td><td class="num">' + c(g.up12) + '</td><td class="num">' + c(g.drop10) + '</td></tr>';
        }).join('') + '</table></div><p class="muted" style="font-size:13px;margin-top:8px">Improvement over each market’s own long-run average, tested month by month. If trend rules only worked in the US, they’d be luck.</p></div></details>';
    }
    var errs = Object.keys(M.downloadErrors || {});
    h += '<p class="muted" style="font-size:13px;margin-top:12px">Built ' + fmtDate(M.built.slice(0, 10)) + ' from ' + M.months + ' months of data (' + esc(M.from) + ' → ' + esc(M.asOf) + '). ' +
      (errs.length ? 'Couldn’t download: ' + errs.map(esc).join(', ') + '. ' : '') +
      'Method: logistic regression refit every year on earlier months only; inputs chosen on 1975–1999 if they improved accuracy by at least 1.5%; economic data delayed 1–2 months to when it was actually published. Neighbouring months’ outcomes overlap, so there are fewer independent episodes than months. Sources: FRED, Yahoo Finance, Robert Shiller’s data.</p></section>';
    return h;
  }
  function groupLabel(M, id) { var g = (M.groups || []).filter(function (x) { return x.id === id; })[0]; return g ? g.label : id; }

  // ------------------------------------------------------------ News
  function ago(iso, now) {
    if (!iso) return '';
    var m = Math.max(0, Math.round(((now || Date.now()) - Date.parse(iso)) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    if (m < 48 * 60) return Math.round(m / 60) + 'h ago';
    return Math.round(m / 1440) + 'd ago';
  }
  function toneCls(score) { return score >= 0.07 ? 'pos' : score <= -0.07 ? 'neg' : 'flat'; }
  function gauge(score) {
    var x = ((Math.max(-1, Math.min(1, score)) + 1) / 2 * 100).toFixed(1);
    return '<div class="gauge"><span class="g-mark ' + toneCls(score) + '" style="left:' + x + '%"></span></div>' +
      '<div class="g-scale"><span>Negative</span><span>Neutral</span><span>Positive</span></div>';
  }
  function headline(it, now) {
    return '<li class="hl ' + it.tone + '"><span class="tdot" title="' + it.tone + '"></span><div><a href="' + esc(it.link) + '" target="_blank" rel="noopener noreferrer">' +
      esc(it.title) + '</a><div class="hl-meta">' + esc(it.source || '') + ' · ' + ago(it.published, now) + '</div></div></li>';
  }
  function themeChips(themes, n) {
    return themes.slice(0, n).map(function (t) {
      return '<span class="chip ' + toneCls(t.tone) + '">' + esc(t.theme) + ' · ' + t.count + '</span>';
    }).join('');
  }
  function buildNews(state, result, now) {
    now = now || Date.now();
    var raw = state.news;
    var hold = result ? Object.keys(result.holdings || {}).sort() : [];
    var head = '<div class="toolbar"><span class="muted" style="font-size:14px">' + (raw && raw.fetchedAt ? 'Headlines from the last 14 days · updated ' + ago(raw.fetchedAt, now) : 'Recent headlines for the stocks you hold and the market') +
      '</span><button class="btn" data-act="news" type="button" style="margin-left:auto">' + icon('refresh') + '<span class="lbl">Refresh news</span></button></div>';
    var outlookHtml = buildOutlook(state) + buildModel(state);
    if (!raw || !raw.symbols) {
      return head + outlookHtml + '<div class="grid2 section">' + buildFearGreed(state) + '<div class="card pad empty-note"><p style="margin-bottom:12px">' + (state.newsLoading ? 'Fetching headlines…' : 'No news loaded yet.') + '</p>' +
        (state.newsLoading ? '' : '<button class="btn accent" data-act="news" type="button">Get news</button>') + '</div></div>' + buildTogether(state, result);
    }
    var sum = newsSummary(state, result, now);
    var rows = sum.rows, withNews = sum.withNews, port = sum.port, mkt = sum.mkt;
    var f = state.ui.newsTone || 'all', sort = state.ui.newsSort || 'weight';
    rows.sort({
      weight: function (a, b) { return b.weight - a.weight; }, pos: function (a, b) { return b.score - a.score; },
      neg: function (a, b) { return a.score - b.score; }, az: function (a, b) { return a.symbol < b.symbol ? -1 : 1; }
    }[sort] || function (a, b) { return b.weight - a.weight; });

    var h = head + outlookHtml + '<div class="mood3 section">' + buildFearGreed(state);
    h += '<div class="card pad mood"><div class="eyebrow">Your holdings’ news</div><div class="mood-label ' + toneCls(port) + '">' + N.label(port) + '</div>' +
      gauge(port) + '<p class="mood-sub">Tone ' + (port >= 0 ? '+' : '−') + Math.abs(port).toFixed(2) + ' on a −1 to +1 scale, each stock weighted by its share of your holdings. ' +
      withNews.reduce(function (s, r) { return s + r.positive; }, 0) + ' positive · ' + withNews.reduce(function (s, r) { return s + r.negative; }, 0) + ' negative headlines about your ' + plural(hold.length, 'stock') + '.</p></div>';
    h += '<div class="card pad mood"><div class="eyebrow">Market mood</div><div class="mood-label ' + toneCls(mkt.score) + '">' + N.label(mkt.score) + '</div>' +
      gauge(mkt.score) + '<p class="mood-sub">' + plural(mkt.count, 'market headline') + ' from the last 7 days · ' + mkt.positive + ' positive · ' + mkt.negative + ' negative.</p>' +
      '<div class="chips">' + themeChips(mkt.themes, 6) + '</div></div>';
    h += '</div>' + buildTogether(state, result);

    h += '<div class="section-head"><h2>Your holdings</h2><div class="right">' +
      seg('newsTone', [{ v: 'all', l: 'All headlines' }, { v: 'positive', l: 'Positive' }, { v: 'negative', l: 'Negative' }], f) +
      '<select class="select" data-ctl="newsSort" aria-label="Sort">' + [['weight', 'Largest position first'], ['pos', 'Most positive first'], ['neg', 'Most negative first'], ['az', 'A → Z']].map(function (o) {
        return '<option value="' + o[0] + '"' + (sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div></div>';
    h += '<div class="news-grid">' + rows.map(function (r, i) {
      var list = r.items.filter(function (it) { return it.relevant && (f === 'all' || it.tone === f); });
      var others = r.items.filter(function (it) { return !it.relevant && (f === 'all' || it.tone === f); });
      return '<div class="card pad ncard" style="--i:' + Math.min(i, 10) + '"><div class="ncard-top"><span class="pcard-sym">' + esc(r.symbol) + '</span>' +
        '<span class="ncard-name">' + esc(r.name) + '</span><span class="ncard-w">' + (r.weight * 100).toFixed(1) + '% of holdings</span></div>' +
        (r.count ? '<div class="ncard-tone"><span class="mood-label sm ' + toneCls(r.score) + '">' + N.label(r.score) + '</span><span class="muted">' + r.positive + ' positive · ' + r.negative + ' negative · ' + r.neutral + ' neutral</span></div>' +
          gauge(r.score) + (r.themes.length ? '<div class="chips">' + themeChips(r.themes, 4) + '</div>' : '') +
          (list.length ? '<ul class="hls">' + list.slice(0, 4).map(function (it) { return headline(it, now); }).join('') + '</ul>' :
            '<p class="muted" style="font-size:14px;margin-top:10px">No ' + (f === 'all' ? '' : f + ' ') + 'headlines naming ' + esc(r.symbol) + '.</p>') +
          (list.length > 4 || others.length ? '<details class="more"><summary>' + (list.length > 4 ? (list.length - 4) + ' more' : '') + (list.length > 4 && others.length ? ' · ' : '') +
            (others.length ? others.length + ' that mention it in passing' : '') + '</summary><div class="more-body"><ul class="hls">' +
            list.slice(4).concat(others).map(function (it) { return headline(it, now); }).join('') + '</ul></div></details>' : '')
          : '<p class="muted" style="font-size:14px;margin-top:10px">No recent headlines found.</p>') + '</div>';
    }).join('') + '</div>';

    var mlist = mkt.items.filter(function (it) { return f === 'all' || it.tone === f; });
    h += '<section class="section card pad" style="margin-top:22px"><div class="section-head"><h2>Market headlines</h2><span class="hint">what’s moving the S&amp;P 500 this week</span></div>' +
      (mlist.length ? '<ul class="hls">' + mlist.slice(0, 10).map(function (it) { return headline(it, now); }).join('') + '</ul>' : '<p class="muted">No headlines.</p>') + '</section>';
    h += buildToneHistory(state);
    h += '<p class="muted" style="font-size:13px">Tone is read from the words in each headline (e.g. “beats estimates”, “raises guidance”, “upgrade” vs. “misses”, “lawsuit”, “downgrade”), newer headlines counting more. It summarizes the news; it isn’t a forecast. Sources: Yahoo Finance and Google News.</p>';
    return h;
  }

  // ------------------------------------------------------------ Data
  function buildData(state, result) {
    var h = '<section class="section"><div class="drop" id="dropZone" role="button" tabindex="0">' + icon('data') +
      '<h3>Drop CSV files here, or click to choose</h3><p>Fidelity history exports, plus an optional monthly-returns sheet — detected automatically. Re-uploading adds only new rows.</p></div></section>';
    var tx = state.transactions, dates = tx.map(function (t) { return t.date; }).sort();
    h += '<div class="grid2 section">';
    var byAcct = {};
    tx.forEach(function (t) { var id = E.accountOf(t); (byAcct[id] = byAcct[id] || []).push(t.date); });
    var ids = Object.keys(byAcct).sort();
    if (ids.length) {
      h += '<div class="card pad"><div class="section-head"><h2>Accounts</h2><span class="hint">found in your Fidelity files</span></div>' +
        ids.map(function (id) {
          var a = (state.accounts || {})[id] || { name: 'Fidelity account', type: 'Other' }, d = byAcct[id].sort();
          return '<div class="acct-row"><input type="text" data-acct="' + esc(id) + '" data-field="name" value="' + esc(a.name) + '" aria-label="Account name">' +
            '<select class="select" data-acct="' + esc(id) + '" data-field="type" aria-label="Account type">' + TYPES.map(function (t) {
              return '<option' + (t === a.type ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
            '<div class="meta">Account ··' + esc(id.slice(-4)) + ' · ' + d.length + ' transactions · ' + fmtDate(d[0]) + ' – ' + fmtDate(d[d.length - 1]) + '</div></div>';
        }).join('') + '<p class="muted" style="font-size:13px;margin-top:8px">Matched by the account number in each file name. The type is a best guess from the transactions — change it if it’s wrong; the Portfolio page uses it to line accounts up with your sheet.</p></div>';
    }

    h += '<div class="card pad"><div class="section-head"><h2>Fidelity history</h2></div>' +
      (tx.length ? '<div class="stat-line"><span>Transactions</span><span>' + tx.length + '</span></div><div class="stat-line"><span>Covers</span><span>' + fmtDate(dates[0]) + ' – ' +
        fmtDate(dates[dates.length - 1]) + '</span></div>' : '<p class="muted">No files yet.</p>') +
      '<ul class="file-list">' + state.files.slice().sort().map(function (f) { return '<li>' + icon('file') + esc(f) + '</li>'; }).join('') + '</ul></div>';
    h += '<div class="card pad"><div class="section-head"><h2>Prices</h2></div>' +
      '<div class="stat-line"><span>Prices as of</span><span>' + (result ? fmtDate(result.endDate) + (result.live ? ' · live ' + esc(state.liveAsOf || '') : ' close') : '—') + '</span></div>' +
      '<div class="stat-line"><span>Benchmark</span><span>' + (result && result.indexIsTotalReturn ? 'S&amp;P 500 total return' : 'S&amp;P 500 price index (refresh for total return)') + '</span></div>' +
      '<div class="stat-line"><span>Daily history</span><span>' + Object.keys(state.history || {}).length + ' symbols</span></div>' +
      '<div class="stat-line"><span>Last refreshed</span><span>' + esc(state.lastRefresh || 'never') + '</span></div>' +
      '<div style="margin-top:14px"><button class="btn" data-act="refresh" type="button">' + icon('refresh') + '<span class="lbl">Refresh prices</span></button></div></div>';
    var pf = state.portfolio;
    h += '<div class="card pad"><div class="section-head"><h2>Portfolio sheet</h2></div>' +
      (pf ? P.ACCOUNTS.map(function (a) {
        var r = pf.accounts[a.id] || [];
        return '<div class="stat-line"><span>' + a.label + '</span><span>' + (r.length ? r.length + ' months · ' + r[0][0] + ' – ' + r[r.length - 1][0] : '—') + '</span></div>';
      }).join('') + '<div class="stat-line"><span>S&amp;P 500</span><span>' + pf.sp.length + ' months</span></div><div class="stat-line"><span>Source</span><span>' + esc(pf.source || '') + '</span></div>' :
        '<p class="muted">Not imported yet.</p>') + '</div>';
    if (result) {
      var hs = Object.keys(result.holdings).sort();
      h += '<div class="card pad"><div class="section-head"><h2>Account check</h2></div>' +
        '<div class="stat-line"><span>Rebuilt account value</span><span>' + fmtMoney(result.accountValue) + '</span></div>' +
        hs.map(function (s) { var x = result.holdings[s]; return '<div class="stat-line"><span>' + esc(s) + ' · ' + fmtShares(x.shares) + ' sh</span><span>' + fmtMoney(x.shares * x.price) + '</span></div>'; }).join('') +
        '<div class="stat-line"><span>Cash (incl. money market)</span><span>' + fmtMoney(result.cash) + '</span></div>' +
        '<p class="muted" style="font-size:12px;margin-top:10px">' + (result.cashCheck.checked ? (result.cashCheck.matched === result.cashCheck.checked ?
          '✓ Cash matches Fidelity’s Cash Balance on all ' + result.cashCheck.checked + ' days checked.' : 'Cash differs from Fidelity on some days — see notes.') :
          'Re-upload your files once to turn on the daily cash check.') + ' Compare the value with your Fidelity balance.</p></div>';
    }
    h += '<div class="card pad"><div class="section-head"><h2>Settings</h2></div><ul class="settings">' +
      '<li><div><div class="set-name">Hide dollar amounts</div><div class="set-desc">For showing your performance to someone: dollar amounts and share counts become $•••; percentages, pp and growth charts stay. Stays on until you turn it off here.</div></div>' +
      '<label class="toggle"><input type="checkbox" data-act-toggle="privacy"' + (PRIVATE ? ' checked' : '') + ' aria-label="Hide dollar amounts"><span class="track"></span></label></li>' +
      '</ul></div>';
    h += '</div>';
    if (result && result.warnings.length) h += '<section class="section"><div class="section-head"><h2>Notes</h2></div>' + result.warnings.map(function (w) { return '<div class="warn">' + esc(maskText(w)) + '</div>'; }).join('') + '</section>';
    h += '<section class="section card pad prose"><div class="section-head"><h2>How this is calculated</h2></div>' +
      '<p><strong>Overview headline (pp):</strong> your time-weighted return minus the S&amp;P 500 total-return index (dividends reinvested) over the same dates. Your account is rebuilt day by day from the Fidelity rows — every share, fractions included, at that day’s price, plus cash. Each day’s return is today’s value ÷ (yesterday’s value + money that arrived today) − 1, chained, so deposits and rollovers never distort it.</p>' +
      '<p><strong>Dollars:</strong> your gain = account value − money in. Buy-and-hold = the same deposits, each put into the total-return index the day it arrived. Money in is outside money only; dividends and interest are part of your return.</p>' +
      '<p><strong>Years</strong> judge the purchases made that year, each from its buy date to its sale (or today), dividends included, against the same dollars in the index over exactly the same dates — year-end is not a stopping point.</p>' +
      '<p><strong>Purchases</strong> match sales to the oldest shares first; reinvested dividends add shares to the purchase that earned them. <strong>Portfolio</strong> charts the selected account’s monthly returns (calculated from your files, or from an imported sheet); both lines compound the same months from 1.0, and the worst drawdown is measured from the highest point to the lowest point after it.</p></section>';
    h += '<section class="section"><button class="btn danger" data-act="startover" type="button">Start over — delete saved data</button></section>';
    return h;
  }

  function buildWelcome() {
    return '<div class="welcome"><h2>See how your trading did <em>vs. the S&amp;P 500</em></h2>' +
      '<p>Export your history from Fidelity (Accounts → History → Download) as CSV — one file per year works well — and drop the files below. Everything is computed on this computer; the only network use is fetching prices.</p>' +
      '<div class="drop" id="dropZone" role="button" tabindex="0">' + icon('data') + '<h3>Drop Fidelity CSV files here</h3><p>or click to choose</p></div></div>';
  }

  var VIEWS = {
    overview: { title: 'Overview' }, years: { title: 'Years' }, purchases: { title: 'Purchases' },
    portfolio: { title: 'Portfolio' }, news: { title: 'News & Market' }, data: { title: 'Data' }
  };

  // ------------------------------------------------------------ Node exports
  var isBrowser = typeof document !== 'undefined' && typeof window !== 'undefined' && !window.__NODE_TEST__;
  if (!isBrowser) {
    if (typeof module === 'object' && module.exports) {
      module.exports = { setPrivate: setPrivate, fmtMoney: fmtMoney, fmtMoney2: fmtMoney2, fmtPct: fmtPct, fmtPp: fmtPp, fmtDate: fmtDate, esc: esc,
        mergeIndex: mergeIndex, buildOverview: buildOverview, buildYears: buildYears, buildPurchases: buildPurchases,
        buildLotDetail: buildLotDetail, buildPortfolio: buildPortfolio, buildData: buildData, buildWelcome: buildWelcome,
        filterLots: filterLots, sortLots: sortLots, verdictCounts: verdictCounts, DEFAULT_UI: DEFAULT_UI,
        pfAccounts: pfAccounts, pickPf: pickPf, buildNews: buildNews, buildOutlook: buildOutlook, buildModel: buildModel, buildDividends: buildDividends, TYPES: TYPES };
    }
    return;
  }

  // ------------------------------------------------------------ browser app
  var state = { transactions: [], prices: {}, files: [], indexExtra: [], history: {}, trHistory: [],
    live: false, liveAsOf: null, liveDate: null, lastRefresh: null, sp500: null, portfolio: null,
    accounts: {}, account: null, ui: Object.assign({}, DEFAULT_UI) };
  var result = null, results = {}, dirty = true;
  function pref(k, v) {
    try { if (v === undefined) return JSON.parse(localStorage.getItem('tp.' + k)); localStorage.setItem('tp.' + k, JSON.stringify(v)); } catch (e) { return null; }
  }
  var $ = function (id) { return document.getElementById(id); };
  var viewEl = $('view'), fileInput = $('fileInput');

  function toast(msg, err) {
    var t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 320); }, err ? 7000 : 4200);
  }

  // One calculation per Fidelity account (matched by the account number in
  // each file name); the Overview/Years/Purchases pages show the selected one.
  function ensureAccounts() {
    var groups = {};
    state.transactions.forEach(function (t) { var id = E.accountOf(t); (groups[id] = groups[id] || []).push(t); });
    Object.keys(groups).forEach(function (id) {
      if (!state.accounts[id]) {
        var type = E.inferAccountType(groups[id]);
        state.accounts[id] = { name: type + (id === 'default' ? '' : ' ··' + id.slice(-4)), type: type };
      }
    });
    if (!groups[state.account]) state.account = Object.keys(groups).sort()[0] || null;
    return groups;
  }
  function compute() {
    if (!dirty) return;
    dirty = false;
    results = {}; result = null;
    if (!state.transactions.length) return;
    var groups = ensureAccounts();
    var bench = E.buildBenchmark(state.trHistory, mergeIndex(state.sp500, state.indexExtra));
    var index = new E.IndexSeries(bench.rows);
    Object.keys(groups).forEach(function (id) {
      var r = E.compute(groups[id], index, state.prices, { history: state.history, indexIsTotalReturn: bench.isTotalReturn });
      r.live = state.live && r.endDate === (state.liveDate || '');
      r.liveAsOf = state.liveAsOf;
      results[id] = r;
    });
    result = results[state.account] || null;
  }

  // ---- routing ----
  function route() {
    var parts = (location.hash || '#/overview').slice(2).split('/');
    var v = VIEWS[parts[0]] ? parts[0] : 'overview';
    return { view: v, arg: parts[1] ? decodeURIComponent(parts[1]) : null };
  }
  var lastView = null;
  function render(keepScroll) {
    compute();
    var r = route();
    var hasData = !!result;
    if (r.view === 'purchases' && r.view !== lastView) state.ui.year = r.arg || 'all';
    if (r.view === 'purchases' && r.arg) state.ui.year = r.arg;
    var title = VIEWS[r.view].title, sub = '', html;
    if (!hasData && r.view !== 'portfolio' && r.view !== 'data') { html = buildWelcome(); title = 'Welcome'; }
    else if (r.view === 'overview') { html = buildOverview(state, result); sub = acctName() + ' · ' + fmtDate(result.startDate) + ' – ' + fmtDate(result.endDate); }
    else if (r.view === 'years') {
      var y = r.arg && result.cohorts[r.arg] ? r.arg : 'all';
      html = buildYears(state, result, y); title = y === 'all' ? 'All buys' : y + ' buys'; sub = acctName() + ' · followed from purchase to sale';
    } else if (r.view === 'purchases') {
      html = buildPurchases(state, result); sub = (state.ui.year === 'all' ? 'all years' : state.ui.year + ' buys') + ' · each judged over its own window';
    } else if (r.view === 'portfolio') {
      var list = pfAccounts(state, results);
      var cur = pickPf(state, list);
      html = buildPortfolio(state, list); sub = cur ? cur.label + ' · ' + (cur.source === 'fidelity' ? 'calculated from your Fidelity files' : 'from your sheet') : '';
    } else if (r.view === 'news') {
      state.indexRows = mergeIndex(state.sp500, state.indexExtra);
      html = buildNews(state, result); title = 'News & Market'; sub = 'economy outlook, market mood and the news on your stocks';
      var stale = !state.news || !state.news.fetchedAt || Date.now() - Date.parse(state.news.fetchedAt) > 30 * 60000;
      if (stale && !state.newsLoading && !state.newsTried) { state.newsTried = true; setTimeout(fetchNews, 50); }
      var mStale = !state.market || !state.market.fetchedAt || Date.now() - Date.parse(state.market.fetchedAt) > 60 * 60000;
      if (mStale && !state.marketLoading && !state.marketTried) { state.marketTried = true; setTimeout(fetchMarket, 60); }
      var om = state.outlookModel;
      if ((!om || !om.built || Date.now() - Date.parse(om.built) > 7 * 864e5) && !state.modelStatus && !state.modelTried) { state.modelTried = true; setTimeout(buildOutlookModel, 80); }
    } else { html = buildData(state, result); sub = 'files, prices and checks'; }
    $('viewTitle').textContent = title;
    $('viewSub').textContent = sub;
    var changed = r.view !== lastView;
    viewEl.innerHTML = html;
    if (changed || !keepScroll) {
      viewEl.classList.remove('enter'); void viewEl.offsetWidth; viewEl.classList.add('enter');
      if (changed) window.scrollTo({ top: 0, behavior: 'auto' });
    } else viewEl.classList.remove('enter');
    lastView = r.view;
    renderNav(r.view);
    renderAccountPicker(r.view, list);
    wireView(r, changed || !keepScroll);
  }

  function acctName() { return result && state.accounts[state.account] ? state.accounts[state.account].name : 'Fidelity history'; }
  // One picker for every account page. On Portfolio it also lists accounts
  // that exist only in an imported sheet (values are 'fid:<id>' / 'sheet:<id>').
  function renderAccountPicker(view, pfList) {
    var sel = $('acctSelect'), ids = Object.keys(results).sort(), show, html;
    function opt(v, label, on) { return '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(label) + '</option>'; }
    if (view === 'portfolio') {
      var list = pfList || [], cur = pickPf(state, list);
      var fid = list.filter(function (a) { return a.source === 'fidelity'; }), sh = list.filter(function (a) { return a.source === 'sheet'; });
      var o = function (a) { return opt(a.key, a.label, cur && a.key === cur.key); };
      show = list.length > 1;
      html = fid.length && sh.length ? '<optgroup label="Fidelity accounts">' + fid.map(o).join('') + '</optgroup><optgroup label="From your sheet">' + sh.map(o).join('') + '</optgroup>'
        : list.map(o).join('');
    } else {
      show = ids.length > 1 && view !== 'data';
      html = ids.map(function (id) { return opt(id, state.accounts[id].name, id === state.account); }).join('');
    }
    sel.hidden = !show;
    if (show) sel.innerHTML = html;
  }
  function selectAccount(v) {
    v = String(v || '');
    if (v.indexOf('sheet:') === 0) { state.ui.acct = v; pref('pfSheet', v); render(true); return; }
    if (v.indexOf('fid:') === 0) v = v.slice(4);
    state.account = v; state.ui.acct = ''; pref('account', v); pref('pfSheet', ''); dirty = true; render();
  }
  function renderNav(active) {
    var items = NAV.map(function (n) {
      return '<a class="nav-item' + (n.id === active ? ' active' : '') + '" href="#/' + n.id + '">' + icon(n.id) + '<span>' + n.label + '</span>' +
        (n.id === 'data' && result && result.warnings.length ? '<span class="badge">' + result.warnings.length + '</span>' : '') + '</a>';
    }).join('');
    $('sideNav').innerHTML = items;
    $('tabBar').innerHTML = NAV.map(function (n) {
      return '<button type="button" data-nav="' + n.id + '" class="' + (n.id === active ? 'active' : '') + '">' + icon(n.id) + n.label + '</button>';
    }).join('');
    $('tabBar').querySelectorAll('button').forEach(function (b) {
      b.onclick = function () { location.hash = '#/' + b.getAttribute('data-nav'); };
    });
    var pill = $('pricePill');
    pill.innerHTML = '<span class="dot' + (result && result.live ? ' live' : '') + '"></span><span>' +
      (result ? (result.live ? 'Live · ' + esc(state.liveAsOf || '') : 'Close · ' + fmtDate(result.endDate)) : 'No prices yet') + '</span>';
  }

  // ---- animations ----
  function countUp(root) {
    var els = root.querySelectorAll('[data-count]');
    var t0 = performance.now(), dur = 900;
    els.forEach(function (el) { el._to = parseFloat(el.getAttribute('data-count')); el._f = FMT[el.getAttribute('data-fmt')]; });
    function tick(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      els.forEach(function (el) { el.textContent = el._f(el._to * e); });
      if (k < 1) requestAnimationFrame(tick);
    }
    if (els.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) requestAnimationFrame(tick);
  }
  var segPos = {};
  function placeSegs(root, animate) {
    root.querySelectorAll('.seg').forEach(function (s) {
      var a = s.querySelector('button.active'), th = s.querySelector('.thumb');
      if (!a || !th) return;
      var id = s.getAttribute('data-seg'), prev = segPos[id];
      var to = { left: a.offsetLeft, width: a.offsetWidth };
      if (prev && animate !== false) {
        th.style.transition = 'none'; th.style.left = prev.left + 'px'; th.style.width = prev.width + 'px';
        void th.offsetWidth; th.style.transition = '';
      }
      th.style.left = to.left + 'px'; th.style.width = to.width + 'px';
      segPos[id] = to;
    });
  }

  // ---- per-view wiring ----
  function setUi(k, v, rerender) {
    state.ui[k] = v;
    if (rerender !== false) render(true);
  }
  function wireView(r, fresh) {
    placeSegs(viewEl);
    if (fresh) countUp(viewEl);
    viewEl.querySelectorAll('.seg button').forEach(function (b) {
      b.onclick = function () {
        var segId = b.parentNode.getAttribute('data-seg'), v = b.getAttribute('data-val');
        if (segId === 'year') { location.hash = '#/years/' + v; return; }
        if (segId === 'pyear') {
          b.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
          placeSegs(b.parentNode.parentNode);
          state.ui.symbol = 'all';
          history.replaceState(null, '', '#/purchases' + (v === 'all' ? '' : '/' + v));
          setTimeout(function () { setUi('year', v); }, 160);
          return;
        }
        b.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
        placeSegs(b.parentNode.parentNode);
        setTimeout(function () { setUi(segId === 'ovChart' ? 'chart' : segId, v); }, 160);
      };
    });
    viewEl.querySelectorAll('.pill[data-kind]').forEach(function (b) {
      b.onclick = function () { setUi(b.getAttribute('data-kind'), b.getAttribute('data-val')); };
    });
    viewEl.querySelectorAll('[data-ctl]').forEach(function (c) {
      c.onchange = function () {
        var k = c.getAttribute('data-ctl');
        if (k === 'year') { state.ui.symbol = 'all'; state.ui.year = c.value; history.replaceState(null, '', '#/purchases' + (c.value === 'all' ? '' : '/' + c.value)); render(true); return; }
        setUi(k, c.type === 'checkbox' ? c.checked : c.value);
      };
    });
    viewEl.querySelectorAll('[data-acct]').forEach(function (c) {
      c.onchange = function () {
        var id = c.getAttribute('data-acct'), f = c.getAttribute('data-field');
        state.accounts[id] = Object.assign({}, state.accounts[id], (function () { var o = {}; o[f] = c.value; return o; })());
        dirty = true; saveData(); toast('Saved: ' + state.accounts[id].name + ' · ' + state.accounts[id].type); render(true);
      };
    });
    viewEl.querySelectorAll('[data-act-toggle="privacy"]').forEach(function (c) {
      c.onchange = function () { togglePrivacy(c.checked); };
    });
    viewEl.querySelectorAll('[data-rail]').forEach(function (b) {
      b.onclick = function () {
        var r = b.closest('.rail-head').nextElementSibling;
        r.scrollBy({ left: +b.getAttribute('data-rail') * r.clientWidth * 0.85, behavior: 'smooth' });
      };
    });
    viewEl.querySelectorAll('[data-lot]').forEach(function (b) {
      b.onclick = function () { openLot(b.getAttribute('data-lot')); };
    });
    viewEl.querySelectorAll('[data-stock]').forEach(function (b) {
      b.onclick = function () { state.ui.symbol = b.getAttribute('data-stock'); state.ui.mode = 'cards'; render(true); };
    });
    viewEl.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () { var a = b.getAttribute('data-act'); if (a === 'refresh') refreshPrices(true); if (a === 'startover') startOver(); if (a === 'news') { fetchNews(); fetchMarket(); } if (a === 'model') buildOutlookModel(); };
    });
    var dz = $('dropZone');
    if (dz) {
      dz.onclick = function () { fileInput.click(); };
      dz.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); };
    }
    if (r.view === 'overview' && result) drawOverviewChart();
    if (r.view === 'portfolio' && $('pfLine')) drawPortfolioCharts();
    if (r.view === 'news') drawNewsCharts();
  }

  function drawOverviewChart() {
    var el = $('ovChart'); if (!el) return;
    var s = result.series, step = Math.max(1, Math.floor(s.length / 600));
    var pts = s.filter(function (_, i) { return i % step === 0 || i === s.length - 1; });
    var labels = pts.map(function (p) { return p.date; });
    var dollars = !PRIVATE && state.ui.chart !== 'growth';
    var legend = dollars
      ? '<span><i style="background:#c45c0c"></i>Your account</span><span><i class="dash"></i>Same deposits in the S&amp;P 500</span><span><i style="background:#ddc99a"></i>Money in</span>'
      : '<span><i style="background:#c45c0c"></i>You (time-weighted)</span><span><i class="dash"></i>S&amp;P 500 total return</span>';
    $('ovLegend').innerHTML = legend;
    $('chartHint').innerHTML = dollars ? 'your account vs. the same deposits in the S&amp;P 500' : 'growth of $1, deposits removed';
    var series = dollars ? [
      { values: pts.map(function (p) { return p.invested; }), color: '#ddc99a', width: 1.5 },
      { values: pts.map(function (p) { return p.shadow; }), color: '#9a7d52', dash: true, width: 1.8 },
      { values: pts.map(function (p) { return p.value; }), color: '#c45c0c', area: true, width: 2.4 }
    ] : [
      { values: pts.map(function (p) { return (p.benchCum - 1) * 100; }), color: '#9a7d52', dash: true, width: 1.8 },
      { values: pts.map(function (p) { return (p.cum - 1) * 100; }), color: '#c45c0c', area: true, width: 2.4 }
    ];
    Charts.line(el, {
      labels: labels, series: series, height: 300, baseline: dollars ? null : 0,
      yFmt: dollars ? function (v) { return Math.abs(v) >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + Math.round(v); } : function (v) { return Math.round(v) + '%'; },
      xFmt: fmtMonthYr,
      tip: function (i) {
        var p = pts[i];
        return '<b>' + fmtDate(p.date) + '</b>' + (dollars
          ? '<div class="r"><span>Your account</span><span>' + fmtMoney(p.value) + '</span></div><div class="r"><span>S&amp;P instead</span><span>' + fmtMoney(p.shadow) +
            '</span></div><div class="r"><span>Money in</span><span>' + fmtMoney(p.invested) + '</span></div><div class="r"><span>Difference</span><span>' + fmtSignedMoney0(p.value - p.shadow) + '</span></div>'
          : '<div class="r"><span>You</span><span>' + fmtPct((p.cum - 1) * 100) + '</span></div><div class="r"><span>S&amp;P 500</span><span>' + fmtPct((p.benchCum - 1) * 100) +
            '</span></div><div class="r"><span>Gap</span><span>' + fmtPp((p.cum - p.benchCum) * 100) + '</span></div>');
      }
    });
  }

  function drawNewsCharts() {
    var fg = (state.market || {}).fearGreed;
    if ($('fgChart') && fg && fg.history && fg.history.length > 2) {
      var hh = fg.history;
      Charts.line($('fgChart'), { labels: hh.map(function (x) { return x[0]; }), height: 120, baseline: 50,
        series: [{ values: hh.map(function (x) { return x[1]; }), color: '#c45c0c', width: 1.8 }],
        yFmt: function (v) { return Math.round(v); }, xFmt: fmtMonthYr,
        tip: function (i) { return '<b>' + fmtDate(hh[i][0]) + '</b><div class="r"><span>Fear &amp; Greed</span><span>' + Math.round(hh[i][1]) + ' · ' + EC.fearGreedLabel(hh[i][1]) + '</span></div>'; } });
    }
    var th = state.newsHistory || [];
    if ($('toneChart') && th.length >= 2) {
      Charts.line($('toneChart'), { labels: th.map(function (x) { return x.date; }), height: 180, baseline: 0,
        series: [{ values: th.map(function (x) { return x.mkt; }), color: '#9a7d52', dash: true, width: 1.8 }, { values: th.map(function (x) { return x.port; }), color: '#c45c0c', width: 2.2 }],
        yFmt: function (v) { return (v > 0 ? '+' : '') + v.toFixed(1); }, xFmt: function (d) { return fmtDateShort(d).replace(/, \d\d$/, ''); },
        tip: function (i) { return '<b>' + fmtDate(th[i].date) + '</b><div class="r"><span>Your holdings</span><span>' + N.label(th[i].port) + '</span></div><div class="r"><span>Market</span><span>' + N.label(th[i].mkt) + '</span></div>'; } });
    }
  }
  function drawPortfolioCharts() {
    var acc = pickPf(state, pfAccounts(state, results));
    if (!acc) return;
    var m = P.metrics(acc.rows, acc.sp), sp = state.ui.sp;
    var labels = ['Start'].concat(m.data.map(function (d) { return d.m; }));
    var series = [{ values: [1].concat(m.data.map(function (d) { return d.nav; })), color: '#c45c0c', area: true, width: 2.4 }];
    if (sp) series.unshift({ values: [1].concat(m.data.map(function (d) { return d.bnav; })), color: '#9a7d52', dash: true, width: 1.8 });
    Charts.line($('pfLine'), {
      labels: labels, series: series, height: 300, baseline: 1,
      yFmt: function (v) { return v.toFixed(2) + '×'; },
      xFmt: function (l) { return l === 'Start' ? '' : l.replace(/ (\d\d)(\d\d)$/, ' ’$2'); },
      tip: function (i) {
        if (i === 0) return '<b>Start</b><div class="r"><span>Growth of $1</span><span>1.000×</span></div>';
        var d = m.data[i - 1];
        return '<b>' + d.m + '</b><div class="r"><span>Month</span><span>' + fmtPct(d.p) + '</span></div>' +
          (sp && d.b != null ? '<div class="r"><span>S&amp;P 500</span><span>' + fmtPct(d.b) + '</span></div><div class="r"><span>Difference</span><span>' + fmtPp(d.p - d.b) + '</span></div>' : '') +
          '<div class="r"><span>Growth of $1</span><span>' + d.nav.toFixed(3) + '×' + (sp ? ' vs ' + d.bnav.toFixed(3) + '×' : '') + '</span></div>';
      }
    });
    Charts.bars($('pfBars'), {
      labels: m.data.map(function (d) { return d.m; }), values: m.data.map(function (d) { return d.p; }),
      compare: sp ? m.data.map(function (d) { return d.b; }) : null, height: 210,
      yFmt: function (v) { return (v > 0 ? '+' : '') + Math.round(v) + '%'; },
      xFmt: function (l) { return l.replace(/ (\d\d)(\d\d)$/, ' ’$2'); },
      tip: function (i) {
        var d = m.data[i];
        return '<b>' + d.m + '</b><div class="r"><span>Account</span><span>' + fmtPct(d.p) + '</span></div>' +
          (sp && d.b != null ? '<div class="r"><span>S&amp;P 500</span><span>' + fmtPct(d.b) + '</span></div>' : '');
      }
    });
  }

  // ---- drawer ----
  function openLot(id) {
    var l = result.purchases.filter(function (x) { return lotId(x) === id; })[0];
    if (!l) return;
    $('drawerTitle').innerHTML = esc(l.symbol) + ' <span class="muted mono" style="font-size:13px;font-weight:400">' + fmtDate(l.buyDate) + '</span>';
    $('drawerBody').innerHTML = buildLotDetail(l, result, state.ui.divs);
    $('drawer').classList.add('show'); $('scrim').classList.add('show');
    $('drawer').setAttribute('aria-hidden', 'false');
  }
  function closeDrawer() {
    $('drawer').classList.remove('show'); $('scrim').classList.remove('show');
    $('drawer').setAttribute('aria-hidden', 'true');
  }

  // ---- data ----
  function saveData() {
    return fetch('/api/save-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: state.transactions, prices: state.prices, files: state.files,
        indexExtra: state.indexExtra, history: state.history, trHistory: state.trHistory,
        live: state.live, liveAsOf: state.liveAsOf, liveDate: state.liveDate, lastRefresh: state.lastRefresh,
        portfolio: state.portfolio, accounts: state.accounts, news: state.news, market: state.market, newsHistory: state.newsHistory, outlookModel: state.outlookModel })
    }).catch(function () { toast('Could not save — is the server running?', true); });
  }
  function allSymbols() {
    var set = {};
    state.transactions.forEach(function (t) {
      var k = E.classify(t);
      if (t.symbol && k !== 'mmcash' && k !== 'income' && k !== 'other') set[t.symbol] = 1;
    });
    return Object.keys(set).sort();
  }
  function firstDate() { return state.transactions.map(function (t) { return t.date; }).sort()[0]; }
  function refreshSince(symbols) {
    var first = firstDate();
    if (!first) return null;
    var complete = state.trHistory.length && state.trHistory[0][0] <= first &&
      symbols.every(function (s) { return state.history[s] && state.history[s].length; });
    if (!complete) return first;
    var last = state.trHistory[state.trHistory.length - 1][0];
    return new Date(Date.parse(last) - 21 * 864e5).toISOString().slice(0, 10);
  }
  function mergeRows(a, b) { return mergeIndex(a, b); }
  var refreshing = false;
  function setRefreshing(on) {
    refreshing = on;
    [$('refreshBtn'), $('sideRefresh')].forEach(function (b) { b.classList.toggle('spinning', on); b.disabled = on; });
    viewEl.querySelectorAll('[data-act="refresh"]').forEach(function (b) { b.classList.toggle('spinning', on); b.disabled = on; });
  }
  function refreshPrices(showToast) {
    if (refreshing || !state.transactions.length) return Promise.resolve();
    var symbols = allSymbols(), since = refreshSince(symbols);
    setRefreshing(true);
    if (showToast && since === firstDate()) toast('Downloading daily history for ' + symbols.length + ' symbols — a few seconds the first time…');
    return fetch('/api/refresh-prices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: symbols, since: since })
    }).then(function (r) { return r.json(); }).then(function (res) {
      var n = 0;
      Object.keys(res.prices || {}).forEach(function (s) { if (s !== '^SPX') { state.prices[s] = res.prices[s]; n++; } });
      if (!n && !(res.trHistory || []).length && !(res.indexHistory || []).length) {
        throw new Error('no prices came back — check the internet connection');
      }
      state.indexExtra = mergeRows(state.indexExtra, res.indexHistory);
      Object.keys(res.history || {}).forEach(function (s) { state.history[s] = mergeRows(state.history[s], res.history[s]); });
      if ((res.trHistory || []).length) state.trHistory = mergeRows(state.trHistory, res.trHistory);
      state.live = !!res.live;
      state.liveDate = res.prices && res.prices['^SPX'] ? res.prices['^SPX'].date : null;
      state.liveAsOf = res.asOf ? new Date(res.asOf * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
      state.lastRefresh = new Date().toLocaleString();
      dirty = true;
      var errs = Object.keys(res.errors || {});
      if (showToast) toast((res.live ? 'Live prices · ' + (state.liveAsOf || '') : 'Prices updated to ' + fmtDate(state.liveDate)) +
        (errs.length ? ' · could not fetch ' + errs.join(', ') : ''), errs.length > 0 && !n);
      return saveData();
    }).catch(function (e) {
      if (showToast) toast('Price refresh failed (' + e.message + '). Showing last known prices.', true);
    }).then(function () { setRefreshing(false); render(true); });
  }

  function fetchNews() {
    if (state.newsLoading || !result) return;
    state.newsLoading = true;
    viewEl.querySelectorAll('[data-act="news"]').forEach(function (b) { b.classList.add('spinning'); b.disabled = true; });
    fetch('/api/news', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: Object.keys(result.holdings || {}) }) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var n = Object.keys(res.symbols || {}).reduce(function (s, k) { return s + res.symbols[k].items.length; }, 0) + ((res.market || {}).items || []).length;
        if (!n) throw new Error('no headlines came back — check the internet connection');
        state.news = res;
        var sm = newsSummary(state, result, Date.now());
        if (sm) {
          var today = new Date().toISOString().slice(0, 10);
          state.newsHistory = (state.newsHistory || []).filter(function (x) { return x.date !== today; })
            .concat([{ date: today, port: +sm.port.toFixed(3), mkt: +sm.mkt.score.toFixed(3) }]).slice(-400);
        }
        saveData();
      })
      .catch(function (e) { toast('Could not fetch news (' + e.message + ').', true); })
      .then(function () { state.newsLoading = false; if (route().view === 'news') render(true); });
  }

  // Download long histories (server) and train/test the model in a worker.
  function buildOutlookModel() {
    if (state.modelStatus) return;
    function status(t) { state.modelStatus = t; if (route().view === 'news') render(true); }
    status('Downloading about 70 years of economic and market history…');
    fetch('/api/outlook-data', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.series || !d.series.SPX) throw new Error('the S&P 500 history didn’t download — check the internet connection');
      status('Training and testing the model on ' + Object.keys(d.series).length + ' data series…');
      return new Promise(function (resolve, reject) {
        var w = new Worker('outlook-worker.js');
        w.onmessage = function (e) { w.terminate(); e.data.ok ? resolve(e.data.result) : reject(new Error(e.data.error)); };
        w.onerror = function (e) { w.terminate(); reject(new Error(e.message || 'worker failed')); };
        w.postMessage(d);
      });
    }).then(function (res) {
      if (res.error) throw new Error(res.error);
      state.outlookModel = res; saveData();
      toast('Outlook model rebuilt and tested.');
    }).catch(function (e) { toast('Could not build the outlook model (' + e.message + ').', true); })
      .then(function () { state.modelStatus = null; if (route().view === 'news') render(true); });
  }
  function fetchMarket() {
    if (state.marketLoading) return;
    state.marketLoading = true;
    fetch('/api/market', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (res) {
      var errs = Object.keys(res.errors || {});
      if (res.macro || res.fearGreed) {
        state.market = Object.assign({}, state.market || {}, res.macro ? { macro: res.macro } : {}, res.fearGreed ? { fearGreed: res.fearGreed } : {}, { fetchedAt: res.fetchedAt });
        saveData();
      }
      if (errs.length) toast('Could not load ' + errs.map(function (e) { return e === 'macro' ? 'economy data (FRED)' : 'Fear & Greed (CNN)'; }).join(' or ') + '.', true);
    }).catch(function (e) { toast('Could not load market data (' + e.message + ').', true); })
      .then(function () { state.marketLoading = false; if (route().view === 'news') render(true); });
  }

  function handleFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    Promise.all(files.map(function (f) { return f.text().then(function (t) { return { name: f.name, text: t }; }); })).then(function (cs) {
      var added = 0, fid = 0, sheet = null, errors = [];
      cs.forEach(function (c) {
        if (P.looksLikeSheet(c.text)) {
          var ps = P.parseSheet(c.text);
          if (ps.error) { errors.push(c.name + ': ' + ps.error); return; }
          sheet = ps; sheet.source = c.name; sheet.importedAt = new Date().toLocaleDateString();
          return;
        }
        var parsed = E.parseFidelityCSV(c.text, c.name);
        if (parsed.error) { errors.push(c.name + ': ' + parsed.error); return; }
        var m = E.mergeTransactions(state.transactions, E.assignOccurrenceKeys(parsed.rows));
        state.transactions = m.merged; added += m.added; fid++;
        if (state.files.indexOf(c.name) === -1) state.files.push(c.name);
      });
      if (sheet) { state.portfolio = sheet; toast('Portfolio sheet imported — ' + P.ACCOUNTS.map(function (a) { return a.label + ' ' + sheet.accounts[a.id].length; }).join(' · ') + ' months.'); }
      if (fid) toast(added ? 'Added ' + added + ' new transactions from ' + plural(fid, 'file') + '.' : 'No new rows — those files were already loaded.');
      errors.forEach(function (e) { toast(e, true); });
      dirty = true;
      saveData().then(function () {
        if (fid && !location.hash.match(/overview|years|purchases/)) location.hash = '#/overview';
        else if (sheet && !fid) location.hash = '#/portfolio';
        render(true);
        if (added) return refreshPrices(true);
      });
    }).catch(function (e) { toast('Could not read the files: ' + e.message, true); });
  }

  function startOver() {
    if (!window.confirm('Start over? This deletes your saved transactions, prices and portfolio sheet from this computer. Your CSV files are untouched.')) return;
    fetch('/api/clear-data', { method: 'POST' }).then(function () {
      state.transactions = []; state.prices = {}; state.files = []; state.indexExtra = []; state.history = {}; state.trHistory = [];
      state.live = false; state.lastRefresh = null; state.portfolio = null; state.accounts = {}; state.ui.acct = ''; dirty = true;
    }).then(function () { toast('Cleared.'); location.hash = '#/data'; render(); });
  }

  function togglePrivacy(on) {
    setPrivate(on === undefined ? !PRIVATE : on);
    pref('private', PRIVATE);
    document.body.classList.toggle('private', PRIVATE);
    closeDrawer();
    render(true);
    toast(PRIVATE ? 'Dollar amounts hidden — percentages still show.' : 'Dollar amounts visible.');
  }
  function initChrome() {
    setPrivate(!!pref('private'));
    document.body.classList.toggle('private', PRIVATE);

    $('refreshBtn').innerHTML = icon('refresh') + '<span class="lbl">Refresh</span>';
    $('sideRefresh').innerHTML = icon('refresh') + '<span class="lbl">Refresh prices</span>';
    $('uploadBtn').innerHTML = icon('data') + '<span class="lbl">Upload</span>';
    $('refreshBtn').onclick = $('sideRefresh').onclick = function () { refreshPrices(true); };
    $('uploadBtn').onclick = function () { fileInput.click(); };
    state.account = pref('account');
    state.ui.acct = pref('pfSheet') || '';
    $('acctSelect').onchange = function () { selectAccount(this.value); };
    fileInput.onchange = function () { handleFiles(fileInput.files); fileInput.value = ''; };
    $('scrim').onclick = closeDrawer; $('drawerClose').onclick = closeDrawer;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
    window.addEventListener('hashchange', function () { closeDrawer(); render(); });
    window.addEventListener('scroll', function () { $('topbar').classList.toggle('scrolled', window.scrollY > 4); }, { passive: true });
    // Drop files anywhere.
    var depth = 0, veil = $('dropVeil');
    window.addEventListener('dragenter', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1) { depth++; veil.classList.add('show'); } });
    window.addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) veil.classList.remove('show'); });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); depth = 0; veil.classList.remove('show'); handleFiles(e.dataTransfer.files); });
    // Mobile: swipe the bottom sheet down to close.
    var y0 = null, dr = $('drawer');
    dr.addEventListener('touchstart', function (e) { if ($('drawerBody').scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
    dr.addEventListener('touchmove', function (e) { if (y0 !== null && e.touches[0].clientY - y0 > 90) { y0 = null; closeDrawer(); } }, { passive: true });
  }

  function init() {
    initChrome();
    Promise.all([
      fetch('sp500.json').then(function (r) { return r.json(); }),
      fetch('regime-table.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/api/load-data').then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (res) {
      state.sp500 = res[0];
      state.regimeTable = res[1];
      var s = res[2] || {};
      ['transactions', 'prices', 'files', 'indexExtra', 'history', 'trHistory', 'live', 'liveAsOf', 'liveDate', 'lastRefresh', 'portfolio', 'accounts', 'news', 'market', 'newsHistory', 'outlookModel'].forEach(function (k) {
        if (s[k] !== undefined && s[k] !== null) state[k] = s[k];
      });
    }).then(function () {
      dirty = true;
      render();
      // Stale prices on open? Refresh quietly in the background.
      if (state.transactions.length && (!state.trHistory.length || !Object.keys(state.history).length)) refreshPrices(false);
    }).catch(function (err) {
      viewEl.innerHTML = '<div class="welcome"><h2>Could not start</h2><p>' + esc(err.message) + '</p><p>Make sure the server is running (Start.command, or <code>python3 server.py</code> in this folder) and reload.</p></div>';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
