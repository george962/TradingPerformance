/* Tiny SVG charts with hover tooltips and draw-in animation. No deps. */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  function niceTicks(min, max, n) {
    var span = max - min || Math.abs(max) || 1;
    var step = Math.pow(10, Math.floor(Math.log10(span / n)));
    var err = span / n / step;
    step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var ticks = [];
    for (var v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }

  function mount(el, render) {
    var first = true;
    function draw() {
      var w = el.clientWidth || 600;
      el.innerHTML = '';
      render(w, first);
      first = false;
    }
    draw();
    if (typeof ResizeObserver !== 'undefined') {
      var last = el.clientWidth, t;
      var ro = new ResizeObserver(function () {
        if (Math.abs(el.clientWidth - last) < 4) return;
        last = el.clientWidth; clearTimeout(t); t = setTimeout(draw, 80);
      });
      ro.observe(el);
    }
  }

  function tipEl(el) {
    var tip = document.createElement('div');
    tip.className = 'tip';
    el.appendChild(tip);
    return tip;
  }
  function placeTip(tip, el, x, y, W) {
    tip.classList.add('show');
    var tw = tip.offsetWidth || 160;
    var left = x + 14;
    if (left + tw > W) left = x - tw - 14;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = Math.max(0, y - 30) + 'px';
  }

  // opts: { labels: [...], series: [{ values, color, dash, area, name }],
  //         height, yFmt(v), xFmt(label), tip(i) -> html, baseline }
  function line(el, opts) {
    mount(el, function (W, animate) {
      var H = opts.height || 280, pL = 64, pR = 14, pT = 14, pB = 30;
      var n = opts.labels.length;
      if (n < 2) { el.innerHTML = '<div class="empty-note">Not enough data to chart yet.</div>'; return; }
      var all = [];
      opts.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null && isFinite(v)) all.push(v); }); });
      if (opts.baseline != null) all.push(opts.baseline);
      var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
      var pad = (mx - mn) * 0.06 || 1; mn -= pad; mx += pad;
      var ticks = niceTicks(mn, mx, 5);
      function x(i) { return pL + i / (n - 1) * (W - pL - pR); }
      function y(v) { return pT + (1 - (v - mn) / (mx - mn)) * (H - pT - pB); }
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('height', H);
      var h = '';
      ticks.forEach(function (t) {
        h += '<line x1="' + pL + '" x2="' + (W - pR) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="#efe1c6"/>' +
          '<text x="' + (pL - 8) + '" y="' + (y(t) + 4) + '" text-anchor="end" fill="#9a7d52" font-size="10" font-family="Source Code Pro,monospace">' + opts.yFmt(t) + '</text>';
      });
      if (opts.baseline != null && opts.baseline > mn && opts.baseline < mx) {
        h += '<line x1="' + pL + '" x2="' + (W - pR) + '" y1="' + y(opts.baseline) + '" y2="' + y(opts.baseline) + '" stroke="#ddc99a" stroke-dasharray="4 3"/>';
      }
      var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - pL) / 90))));
      for (var i = 0; i < n; i += every) {
        h += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle" fill="#9a7d52" font-size="10" font-family="Source Code Pro,monospace">' + (opts.xFmt ? opts.xFmt(opts.labels[i]) : opts.labels[i]) + '</text>';
      }
      opts.series.forEach(function (s, k) {
        var pts = [];
        s.values.forEach(function (v, i) { if (v != null && isFinite(v)) pts.push(x(i).toFixed(1) + ',' + y(v).toFixed(1)); });
        if (!pts.length) return;
        if (s.area) {
          var gid = 'g' + Math.random().toString(36).slice(2);
          h += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + s.color + '" stop-opacity=".18"/><stop offset="1" stop-color="' + s.color + '" stop-opacity="0"/></linearGradient></defs>';
          h += '<polygon class="' + (animate ? 'area' : '') + '" fill="url(#' + gid + ')" points="' + x(0) + ',' + (H - pB) + ' ' + pts.join(' ') + ' ' + x(n - 1) + ',' + (H - pB) + '"/>';
        }
        h += '<polyline data-k="' + k + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.width || 2.2) + '" stroke-linejoin="round" stroke-linecap="round"' +
          (s.dash ? ' stroke-dasharray="5 4"' : '') + ' points="' + pts.join(' ') + '"/>';
      });
      h += '<line class="xh" y1="' + pT + '" y2="' + (H - pB) + '" stroke="rgba(196,92,12,.35)" opacity="0"/>';
      svg.innerHTML = h;
      el.appendChild(svg);
      if (animate) {
        svg.querySelectorAll('polyline').forEach(function (pl) {
          if (pl.getAttribute('stroke-dasharray')) return;
          var len = pl.getTotalLength ? pl.getTotalLength() : 2000;
          pl.style.setProperty('--len', len);
          pl.classList.add('draw');
        });
      }
      var tip = tipEl(el), xh = svg.querySelector('.xh');
      var dots = opts.series.map(function (s) {
        var c = document.createElementNS(NS, 'circle');
        c.setAttribute('r', 4); c.setAttribute('fill', s.color); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', 2); c.setAttribute('opacity', 0);
        svg.appendChild(c); return c;
      });
      function move(ev) {
        var r = svg.getBoundingClientRect();
        var px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * W;
        var i = Math.round((px - pL) / (W - pL - pR) * (n - 1));
        if (i < 0 || i >= n) return leave();
        xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('opacity', 1);
        var topY = H;
        opts.series.forEach(function (s, k) {
          var v = s.values[i];
          if (v == null || !isFinite(v)) { dots[k].setAttribute('opacity', 0); return; }
          dots[k].setAttribute('cx', x(i)); dots[k].setAttribute('cy', y(v)); dots[k].setAttribute('opacity', 1);
          topY = Math.min(topY, y(v));
        });
        tip.innerHTML = opts.tip(i);
        placeTip(tip, el, x(i) / W * r.width, topY / H * r.height, r.width);
      }
      function leave() {
        tip.classList.remove('show'); xh.setAttribute('opacity', 0);
        dots.forEach(function (d) { d.setAttribute('opacity', 0); });
      }
      svg.addEventListener('mousemove', move);
      svg.addEventListener('touchmove', move, { passive: true });
      svg.addEventListener('mouseleave', leave);
      svg.addEventListener('touchend', leave);
    });
  }

  // opts: { labels, values, compare (optional), height, tip(i), yFmt }
  function bars(el, opts) {
    mount(el, function (W, animate) {
      var H = opts.height || 200, pL = 46, pR = 10, pT = 10, pB = 26;
      var n = opts.labels.length;
      if (!n) return;
      var all = opts.values.concat(opts.compare || []).filter(function (v) { return v != null; });
      var mx = Math.max.apply(null, all.map(Math.abs)) * 1.1 || 1;
      function y(v) { return pT + (1 - (v + mx) / (2 * mx)) * (H - pT - pB); }
      var slot = (W - pL - pR) / n, bw = Math.max(2, Math.min(26, slot * (opts.compare ? 0.42 : 0.7)));
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('height', H);
      var h = '';
      niceTicks(-mx, mx, 4).forEach(function (t) {
        h += '<line x1="' + pL + '" x2="' + (W - pR) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="' + (t === 0 ? '#ddc99a' : '#f3e7d0') + '"/>' +
          '<text x="' + (pL - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end" fill="#9a7d52" font-size="10" font-family="Source Code Pro,monospace">' + opts.yFmt(t) + '</text>';
      });
      var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - pL) / 60))));
      opts.values.forEach(function (v, i) {
        var cx = pL + (i + 0.5) * slot;
        if (i % every === 0) h += '<text x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle" fill="#9a7d52" font-size="10" font-family="Source Code Pro,monospace">' + (opts.xFmt ? opts.xFmt(opts.labels[i]) : opts.labels[i]) + '</text>';
        var d = animate ? ' style="animation-delay:' + Math.min(600, i * 12) + 'ms"' : ' style="animation:none"';
        function rect(val, x0, color, op) {
          if (val == null) return '';
          var top = y(Math.max(val, 0)), bot = y(Math.min(val, 0));
          return '<rect class="bar' + (val < 0 ? ' down' : '') + '"' + d + ' x="' + x0.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, bot - top).toFixed(1) + '" rx="2" fill="' + color + '" opacity="' + op + '"/>';
        }
        if (opts.compare) {
          h += rect(v, cx - bw - 1, v >= 0 ? '#2d7a45' : '#b03030', 0.85);
          h += rect(opts.compare[i], cx + 1, '#c8ae82', 0.8);
        } else {
          h += rect(v, cx - bw / 2, v >= 0 ? '#2d7a45' : '#b03030', 0.85);
        }
      });
      svg.innerHTML = h;
      el.appendChild(svg);
      var tip = tipEl(el);
      svg.addEventListener('mousemove', function (ev) {
        var r = svg.getBoundingClientRect();
        var px = (ev.clientX - r.left) / r.width * W;
        var i = Math.floor((px - pL) / slot);
        if (i < 0 || i >= n) { tip.classList.remove('show'); return; }
        tip.innerHTML = opts.tip(i);
        placeTip(tip, el, (pL + (i + 0.5) * slot) / W * r.width, (ev.clientY - r.top), r.width);
      });
      svg.addEventListener('mouseleave', function () { tip.classList.remove('show'); });
    });
  }

  root.Charts = { line: line, bars: bars, niceTicks: niceTicks };
})(typeof self !== 'undefined' ? self : this);
