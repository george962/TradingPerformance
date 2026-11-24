/* News tone tests — plain node. Usage: node tests/test-news.js */
'use strict';
const N = require('../news.js');
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
const now = Date.parse('2026-11-23T20:00:00Z');
const day = d => new Date(now - d * 864e5).toISOString();
check('beat + raise is positive', N.scoreHeadline('Nvidia beats estimates and raises guidance').score > 0.5);
check('downgrade + lawsuit is negative', N.scoreHeadline('Oracle downgraded as lawsuit widens').score < -0.5);
check('plain headline is neutral', N.scoreHeadline('McDonald\'s to hold annual meeting in May').score === 0);
const b = { symbol: 'NVDA', name: 'NVIDIA Corporation', items: [
  { title: 'Nvidia beats estimates, raises outlook', published: day(1), source: 'X', link: 'https://a' },
  { title: 'NVDA shares jump after earnings', published: day(2), source: 'X', link: 'https://b' },
  { title: 'Chip stocks slide as AMD warns', published: day(1), source: 'X', link: 'https://c' },
  { title: 'Nvidia faces antitrust probe in China', published: day(30), source: 'X', link: 'https://d' },
  { title: 'NVDA260116C00180000 option quote', published: day(1), source: 'X', link: 'https://e' }
] };
const a = N.analyzeSymbol(b, now);
check('option-quote junk dropped', a.count === 4, a.count);
check('headlines naming the company are relevant', a.relevantCount === 3, a.relevantCount);
check('overall tone positive (old negative news fades, off-topic counts less)', a.score > 0.2 && a.label === 'Positive', a.score);
check('themes found', a.themes.some(t => t.theme === 'Earnings'));
check('top positive headline', a.topPositive[0].title.indexOf('beats') !== -1);
const m = N.analyzeMarket([{ title: 'Stocks tumble as recession fears grow', published: day(1) }, { title: 'Fed holds rates steady', published: day(2) }], now);
check('market tone negative + themes', m.score < 0 && m.themes.some(t => t.theme === 'Economy & jobs') && m.themes.some(t => t.theme === 'Fed & interest rates'));
check('labels', N.label(0) === 'Neutral' && N.label(0.1) === 'Leaning positive' && N.label(-0.3) === 'Negative');
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
