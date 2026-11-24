/* News tone — scores headlines positive / neutral / negative.
 * Each headline is matched against weighted positive and negative
 * phrases ("beats estimates", "downgrade", "lawsuit", "raises guidance"…);
 * tone = (positive − negative) ÷ max(2, positive + negative), from −1 to +1.
 * A stock's tone is the average of its headlines, newer ones counting more
 * (half-life 7 days) and headlines that don't name the company counting
 * one-fifth as much. This reads headlines; it is not a forecast.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NewsTone = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  var HALF_LIFE = 7;

  var POS = [
    [/\b(beats?|tops?|topped|exceeds?|exceeded)\b.{0,30}\b(estimates?|expectations?|forecasts?|views?)\b/i, 2],
    [/\braises?\b.{0,25}\b(guidance|outlook|forecast|dividend|target|price target)\b/i, 2],
    [/\bupgrade[sd]?\b/i, 2],
    [/\b(record|all-time high|best day|blowout)\b/i, 1.5],
    [/\b(surge[sd]?|soar(s|ed|ing)?|jump(s|ed|ing)?|rall(y|ies|ied|ying)|skyrocket(s|ed)?|spike[sd]?|pop(s|ped)?|climb(s|ed|ing)?|rebound(s|ed|ing)?|ris(es|ing)|rose)\b/i, 1],
    [/\b(outperform|overweight|buy rating|strong buy|top pick)\b/i, 1.5],
    [/\b(wins?|won|awarded|secures?|approval|approved|partnership|deal with|expands?|launch(es|ed)?)\b/i, 1],
    [/\b(buyback|repurchase|dividend increase|hikes? dividend)\b/i, 1],
    [/\b(strong demand|robust|accelerat(es|ing|ed)|bullish|upside|breakthrough|reinstated|returns? as ceo)\b/i, 1],
    [/\b(gains?|gained|higher|up (by )?\d)/i, 0.5]
  ];
  var NEG = [
    [/\b(miss(es|ed)?|falls? short)\b.{0,30}\b(estimates?|expectations?|forecasts?|views?)\b/i, 2],
    [/\b(cuts?|lowers?|slashes?|withdraws?)\b.{0,25}\b(guidance|outlook|forecast|dividend|target|price target)\b/i, 2],
    [/\bdowngrade[sd]?\b/i, 2],
    [/\b(lawsuit|sued|sues|probe|investigation|subpoena|antitrust|fraud|sec charges|class action|indictment)\b/i, 1.5],
    [/\b(plunge[sd]?|plummet(s|ed)?|sinks?|sank|tumble[sd]?|slump(s|ed)?|crash(es|ed)?|sell-?off|crater(s|ed)?|nosedive[sd]?|shed(s|ding)? billions)\b/i, 1.5],
    [/\b(underperform|underweight|sell rating|overvalued|bubble|short seller)\b/i, 1.5],
    [/\b(layoffs?|job cuts|recall|ban(s|ned)?|tariffs?|export curbs?|restrictions?|halts?|delay(s|ed)?)\b/i, 1],
    [/\b(resign(s|ed|ation)?|ousted|fired|steps? down|departure|ceo exit)\b/i, 1],
    [/\b(warns?|warning|weak(er|ness)?|slow(down|ing|s)|decline[sd]?|headwinds?|bearish|struggles?|loses|losses?)\b/i, 1],
    [/\b(concerns?|fears?|risks?|pressure|downside|worr(y|ies|ied))\b/i, 0.5],
    [/\b(falls?|fell|drops?|dropped|slides?|slid|lower|down (by )?\d)/i, 0.5]
  ];
  var THEMES = [
    ['Earnings', /\b(earnings|results|quarter|q[1-4]\b|eps|revenue|profit|guidance|outlook)\b/i],
    ['Analyst ratings', /\b(upgrade|downgrade|price target|analyst|rating|overweight|underweight|outperform)\b/i],
    ['Management', /\b(ceo|cfo|chief|executive|board|resign|steps down|appoint|reinstated|founder)\b/i],
    ['Legal & regulation', /\b(lawsuit|probe|investigation|antitrust|regulator|ftc|doj|sec\b|court|fine|ban)\b/i],
    ['AI & products', /\b(ai|chip|gpu|data center|cloud|launch|product|model|platform|software)\b/i],
    ['Deals & M&A', /\b(acquire|acquisition|merger|deal|partnership|stake|buyout|invest(s|ment) in)\b/i],
    ['Macro & policy', /\b(tariff|fed|rates?|inflation|recession|trade war|china|export|economy|jobs report)\b/i],
    ['Dividends & buybacks', /\b(dividend|buyback|repurchase|payout)\b/i],
    ['Prices & demand', /\b(price[sd]? cut|menu|traffic|same-store|comparable sales|demand|consumers?|value meal)\b/i]
  ];
  var MARKET_THEMES = [
    ['AI & big tech', /\b(ai|nvidia|chip|semiconductor|tech|bubble|magnificent)\b/i],
    ['Economy & jobs', /\b(recession|economy|economic|jobs|unemployment|layoffs?|consumer|gdp|retail sales)\b/i],
    ['Fed & interest rates', /\b(fed|federal reserve|rates?|yields?|treasur|inflation|powell|cpi)\b/i],
    ['Politics & policy', /\b(election|congress|democrats?|republicans?|trump|tariffs?|shutdown|white house|senate|house)\b/i],
    ['Geopolitics & oil', /\b(iran|israel|china|russia|ukraine|war|missile|attack|oil|opec)\b/i],
    ['Earnings', /\b(earnings|guidance|quarterly results|beats|misses)\b/i]
  ];
  // Quote/option/price pages are not news.
  var JUNK = /\b[A-Z]{0,6}\d{6}[CP]\d{8}\b|\b(call|put)\s*\([A-Z]+\d{6}|interactive stock chart|stock price, news, quote|price today, .* live price|tokenized stock|stock quote (and|&) news|\bquote & history\b/i;

  function scoreHeadline(text) {
    var pos = 0, neg = 0;
    POS.forEach(function (r) { if (r[0].test(text)) pos += r[1]; });
    NEG.forEach(function (r) { if (r[0].test(text)) neg += r[1]; });
    return { score: clamp((pos - neg) / Math.max(2, pos + neg), -1, 1), pos: pos, neg: neg };
  }
  function toneOf(score) { return score >= 0.25 ? 'positive' : score <= -0.25 ? 'negative' : 'neutral'; }
  function label(score) {
    return score >= 0.2 ? 'Positive' : score <= -0.2 ? 'Negative' : Math.abs(score) < 0.07 ? 'Neutral' : (score > 0 ? 'Leaning positive' : 'Leaning negative');
  }
  function termsFor(symbol, name) {
    var nm = (name || '').replace(/[,.]|\b(Inc|Corp|Corporation|Co|Ltd|plc|Holdings|Company|Class [A-Z]|The|Trust|Fund)\b/gi, '').replace(/\s+/g, ' ').trim();
    var first = nm.split(' ')[0] || '';
    var t = [symbol];
    if (nm) t.push(nm);
    if (first.length >= 4) { t.push(first); t.push(first.replace(/'s$/i, '')); }
    return t.map(function (x) { return new RegExp('\\b' + x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'); });
  }
  function scoreItems(items, now, isRelevant, themes) {
    return (items || []).filter(function (n) { return n.title && !JUNK.test(n.title); }).map(function (n) {
      var sc = scoreHeadline(n.title);
      if (n.summary) sc.score = clamp(sc.score * 0.75 + scoreHeadline(n.summary).score * 0.25, -1, 1);
      var t = n.published ? Date.parse(n.published) : now - 3 * 864e5;
      var age = Math.max(0, (now - t) / 864e5);
      var rel = isRelevant ? isRelevant(n.title) : true;
      var text = n.title + ' ' + (n.summary || '');
      return {
        title: n.title, link: n.link, source: n.source, published: n.published, ageDays: age,
        score: sc.score, tone: toneOf(sc.score), relevant: rel,
        weight: Math.pow(0.5, age / HALF_LIFE) * (rel ? 1 : 0.2),
        themes: themes.filter(function (th) { return th[1].test(text); }).map(function (th) { return th[0]; })
      };
    });
  }
  function summarize(items) {
    var sw = 0, sws = 0;
    items.forEach(function (it) { sw += it.weight; sws += it.weight * it.score; });
    var score = sw > 0 ? sws / sw : 0;
    var rel = items.filter(function (it) { return it.relevant; });
    var stats = {};
    rel.forEach(function (it) {
      it.themes.forEach(function (th) {
        var s = stats[th] = stats[th] || { theme: th, count: 0, tone: 0 };
        s.count++; s.tone += it.score;
      });
    });
    var themes = Object.keys(stats).map(function (k) { var s = stats[k]; s.tone /= s.count; return s; })
      .sort(function (a, b) { return b.count - a.count; });
    function top(sign) {
      return rel.filter(function (it) { return sign > 0 ? it.score >= 0.25 : it.score <= -0.25; })
        .sort(function (a, b) { return b.weight * Math.abs(b.score) - a.weight * Math.abs(a.score); }).slice(0, 3);
    }
    return {
      score: score, label: label(score), count: items.length, relevantCount: rel.length,
      positive: rel.filter(function (it) { return it.tone === 'positive'; }).length,
      negative: rel.filter(function (it) { return it.tone === 'negative'; }).length,
      neutral: rel.filter(function (it) { return it.tone === 'neutral'; }).length,
      themes: themes, topPositive: top(1), topNegative: top(-1),
      items: items.slice().sort(function (a, b) { return (b.published || '') < (a.published || '') ? -1 : 1; })
    };
  }
  // One holding: { symbol, name, items } from the server.
  function analyzeSymbol(bundle, now) {
    now = now || Date.now();
    var terms = termsFor(bundle.symbol, bundle.name);
    var items = scoreItems(bundle.items, now, function (title) { return terms.some(function (re) { return re.test(title); }); }, THEMES);
    var out = summarize(items);
    out.symbol = bundle.symbol; out.name = bundle.name || '';
    return out;
  }
  // Market-wide headlines.
  function analyzeMarket(items, now) {
    now = now || Date.now();
    var scored = scoreItems(items, now, null, MARKET_THEMES);
    var out = summarize(scored);
    out.themes = MARKET_THEMES.map(function (t) {
      var hits = scored.filter(function (n) { return t[1].test(n.title); });
      return { theme: t[0], count: hits.length, tone: hits.length ? hits.reduce(function (s, n) { return s + n.score; }, 0) / hits.length : 0 };
    }).filter(function (t) { return t.count > 0; }).sort(function (a, b) { return b.count - a.count; });
    return out;
  }
  return { scoreHeadline: scoreHeadline, analyzeSymbol: analyzeSymbol, analyzeMarket: analyzeMarket, label: label, toneOf: toneOf };
});
