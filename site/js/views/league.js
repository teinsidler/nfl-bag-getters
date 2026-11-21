(function () {
  const { P, MONEY, PERF } = BG;
  const range = (p) => +p.from === +p.to ? String(p.from) : p.from + '–' + p.to;
  const modeText = { all: 'all contracts', veteran: 'non-rookie contracts', rookie: 'rookie deals only' };

  dash.draw('lede', (el) => {
    const rows = BG.ranked(), p = P();
    if (!rows) { el.textContent = '—'; return; }
    if (!rows.length) { el.textContent = 'No quarterback meets these filters. Try a lower minimum or a wider range of seasons.'; return; }
    const most = BG.bagSort(rows, p)[0];
    const rate = BG.rate();
    const lede = document.createElement('button'); lede.type = 'button'; lede.className = 'bg-link'; lede.onclick = () => BG.open(most.player_url);
    lede.append(BG.span(most.player, 'leaders', 'player', BG.where(most.player_url), 'bg-name bg-qblink'));
    el.replaceChildren(
      'Across ', range(p), ' (', modeText[p.mode], '), ',
      lede,
      BG.inv(p) ? ' turned it over the most for the money: ' : ' got the biggest bag: ',
      BG.span(BG.unit(most.per_unit, p), 'leaders', 'per_unit', BG.where(most.player_url)),
      ', against a league rate of ',
      BG.span(rate ? BG.unit(rate.rate, p) : '—', 'league', 'rate'),
      '.'
    );
  });

  const tile = (pick) => (el) => {
    const rows = BG.ranked(), p = P();
    if (!rows || !rows.length) { el.textContent = '—'; return; }
    const sorted = BG.bagSort(rows, p);
    const r = pick === 'top' ? sorted[0] : sorted[sorted.length - 1];
    const b = document.createElement('button'); b.className = 'bg-link'; b.onclick = () => BG.open(r.player_url);
    b.append(BG.span(r.player, 'leaders', 'player', BG.where(r.player_url), 'bg-qblink'));
    el.replaceChildren(b);
  };
  const tileNote = (pick) => (el) => {
    const rows = BG.ranked(), p = P();
    if (!rows || !rows.length) { el.textContent = '—'; return; }
    const sorted = BG.bagSort(rows, p);
    const r = pick === 'top' ? sorted[0] : sorted[sorted.length - 1];
    el.replaceChildren(BG.span(BG.unit(r.per_unit, p), 'leaders', 'per_unit', BG.where(r.player_url)), ' · ',
      BG.span(BG.fmtMoney(r.money), 'leaders', 'money', BG.where(r.player_url)), ' for ',
      BG.span(BG.num(r.perf, BG.dec(p.perf)), 'leaders', 'perf', BG.where(r.player_url)), ' ', (r.perf === 1 && PERF[p.perf].one ? PERF[p.perf].one : PERF[p.perf].word) + (PERF[p.perf].part ? ' (' + BG.PART[p.part] + ')' : ''));
  };
  dash.draw('tile-top', tile('top')); dash.draw('tile-top-note', tileNote('top'));
  dash.draw('tile-low', tile('low')); dash.draw('tile-low-note', tileNote('low'));
  dash.draw('tile-rate', (el) => { const r = BG.rate(), p = P(); BG.tween(el, r ? r.rate : null, (v) => BG.unit(v, p), p.money + '|' + p.perf + '|' + p.part); });
  dash.draw('tile-rate-note', (el) => { const p = P(); el.textContent = MONEY[p.money].label + ' ÷ ' + PERF[p.perf].word + (PERF[p.perf].part ? ' (' + BG.PART[p.part] + ')' : '') + ', ' + range(p); });
  dash.draw('part-note', (el) => { const p = P(); el.textContent = PERF[p.perf].part ? 'Counting ' + PERF[p.perf].word + ' from the ' + BG.PART[p.part] + '. Pay is the whole season either way.' : 'Applies to starts, wins, WPA and turnovers, and to the playoff columns. ' + PERF[p.perf].label + ' is regular season only.'; });
  dash.draw('tile-n', (el) => { const r = BG.rate(); BG.tween(el, r ? r.qbs : null, (v) => (v == null ? '—' : BG.num(Math.round(v))), 'qbs'); });
  const SBTXT = { played: 'started a Super Bowl', won: 'won a Super Bowl', won2: 'won 2+ Super Bowls', none: 'never started a Super Bowl' };
  dash.draw('tile-n-note', (el) => { const p = P(); el.textContent = (+p.minatt ? BG.num(+p.minatt) + '+ pass attempts, ' : '') + (+p.minstart ? p.minstart + '+ seasons as starter, ' : '') + (SBTXT[p.sb] ? SBTXT[p.sb] + ', ' : '') + modeText[p.mode]; });

  dash.draw('board-title', (el) => {
    const p = P(), inv = BG.inv(p), bag = p.sort !== 'least';
    el.textContent = (bag ? 'Biggest bag getters: ' : 'Best bargains: ') + ((bag !== inv) ? 'most ' : 'least ') + MONEY[p.money].label.toLowerCase() + ' per ' + PERF[p.perf].per +
      (inv ? (bag ? ' (most turnovers for the money)' : ' (fewest turnovers for the money)') : '');
  });
  dash.draw('th-money', (el) => { el.textContent = MONEY[P().money].short; });
  dash.draw('th-perf', (el) => { el.textContent = PERF[P().perf].short; });
  dash.draw('th-unit', (el) => { el.textContent = 'Per ' + PERF[P().perf].per; });

  dash.draw('board', BG.flipDraw((tb) => {
    const rows = BG.ranked(), p = P();
    const L = dash.data('leaders');
    if (L.status === 'error') { tb.replaceChildren(); const tr = tb.insertRow(); const td = tr.insertCell(); td.colSpan = 6; td.className = 'bg-empty'; td.textContent = 'The pay data didn’t load, so the ranking can’t be shown.'; return; }
    if (!rows) { tb.replaceChildren(); return; }
    const rate = BG.rate();
    const top = rows.slice(0, 25);
    const max = d3.max(top, (r) => r.per_unit) || 1;
    tb.replaceChildren();
    if (!top.length) { const tr = tb.insertRow(); const td = tr.insertCell(); td.colSpan = 6; td.className = 'bg-empty'; td.textContent = 'No quarterback meets these filters.'; return; }
    top.forEach((r, i) => {
      const tr = tb.insertRow(); tr.className = 'bg-row'; tr.dataset.key = r.player_url; tr.tabIndex = 0;
      tr.onclick = () => BG.open(r.player_url);
      tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); BG.open(r.player_url); } };
      const c0 = tr.insertCell(); c0.className = 'bg-rank'; c0.textContent = i + 1;
      const c1 = tr.insertCell(); c1.className = 'bg-name'; c1.append(BG.span(r.player, null, null, null, 'bg-qblink'));
      const sub = document.createElement('span'); sub.className = 'bg-meta'; sub.textContent = r.team + ' · ' + (r.first === r.last ? r.first : r.first + '–' + r.last); c1.append(sub);
      const c2 = tr.insertCell(); c2.className = 'num'; c2.textContent = BG.fmtMoney(r.money);
      const c3 = tr.insertCell(); c3.className = 'num'; c3.textContent = BG.num(r.perf, BG.dec(p.perf));
      if (p.perf === 'wins') c3.textContent = p.part === 'post' ? BG.wl(r.po_wins, r.po_losses) : p.part === 'all' ? BG.wl(r.wins + r.po_wins, r.losses + r.po_losses, r.ties) : BG.wl(r.wins, r.losses, r.ties);
      const c4 = tr.insertCell(); c4.className = 'num'; c4.textContent = BG.unit(r.per_unit, p).split(' / ')[0];
      const c5 = tr.insertCell(); c5.className = 'bg-barcell bg-hide-sm';
      if (rate) { const tk = document.createElement('i'); tk.className = 'bg-rate-tick'; tk.style.left = Math.min(100, rate.rate / max * 100) + '%'; c5.append(tk); }
      const bar = document.createElement('div'); bar.className = 'bg-bar' + (rate && !BG.isBag(r, rate, p) ? ' good' : '');
      bar.style.width = Math.max(2, r.per_unit / max * 100) + '%'; c5.append(bar);
    });
  }));

  dash.draw('zero-title', (el) => { el.textContent = BG.inv(P()) ? 'Paid, with no turnovers' : 'Paid, but no positive production'; });
  dash.draw('zero-note', (el) => { const p = P(); if (BG.inv(p)) { el.textContent = 'Quarterbacks paid during ' + range(p) + ' with no turnovers' + (p.part === 'post' ? ' in the playoff games they started' : '') + ', so pay per turnover can’t be computed. Ignores the attempts minimum.'; return; } el.textContent = 'Quarterbacks paid during ' + range(p) + ' whose ' + PERF[p.perf].word + (p.perf === 'wpa' ? ' came to under 0.5' : ' came to zero or less') + (PERF[p.perf].part && p.part === 'post' ? ' in the playoffs (among those who started a playoff game)' : '') + ', so they can’t be ranked per unit. Ignores the attempts minimum.'; });
  dash.draw('zero', (ul) => {
    const L = dash.data('leaders'), p = P();
    ul.replaceChildren();
    if (L.status !== 'ok' || !Array.isArray(L.data)) return;
    const playoffOnly = PERF[p.perf].part && p.part === 'post';
    const rows = L.data.filter((r) => r.eligible && r.money > 0 && r.per_unit == null && (!playoffOnly || r.po_starts > 0)).sort((a, b) => b.money - a.money).slice(0, 8);
    if (!rows.length) { const li = document.createElement('li'); li.className = 'bg-empty'; li.textContent = 'Nobody in this selection.'; ul.append(li); return; }
    for (const r of rows) {
      const li = document.createElement('li');
      const b = document.createElement('button'); b.className = 'bg-link'; b.onclick = () => BG.open(r.player_url);
      b.append(BG.span(r.player, 'leaders', 'player', BG.where(r.player_url), 'bg-qblink'));
      const left = document.createElement('span'); left.append(b, BG.span(r.team + ' · ' + r.seasons + (r.seasons === 1 ? ' season' : ' seasons') + ' · ' + BG.num(r.perf, BG.dec(p.perf)) + ' ' + PERF[p.perf].word, null, null, null, 'bg-meta'));
      li.append(left, BG.span(BG.fmtMoney(r.money), 'leaders', 'money', BG.where(r.player_url), 'num'));
      ul.append(li);
    }
  });

  // ---- scatter ----
  dash.draw('scatter-note', (el) => {
    el.textContent = BG.inv(P())
      ? 'Each dot is a quarterback. The dashed line is the league rate: dots above it turned the ball over more than the league rate for their pay. The five furthest above are labeled.'
      : 'Each dot is a quarterback. The dashed line is the league rate: dots below it delivered less than the league rate for their pay. The five furthest below are labeled.';
  });
  dash.draw('scatter-legend', (el) => {
    const inv = BG.inv(P()), item = (cls, t) => { const s = document.createElement('span'); const i = document.createElement('i'); i.className = cls; s.append(i, t); return s; };
    el.replaceChildren(item('sw-bag', (inv ? 'Above' : 'Below') + ' the league rate (bag getter)'), item('sw-val', (inv ? 'Below' : 'Above') + ' it (bargain)'), item('sw-line', 'League rate'));
  });
  dash.draw('scatter-title', (el) => { const p = P(); el.textContent = MONEY[p.money].label + ' vs ' + PERF[p.perf].word; });
  dash.draw('scatter', {
    mount: (el) => {
      const svg = d3.select(el).append('svg').attr('role', 'img');
      const tip = d3.select(el).append('div').attr('class', 'bg-tip').attr('hidden', true);
      return { svg, tip };
    },
    update: (el, { svg, tip }) => {
      const rows = BG.ranked(), rate = BG.rate(), p = P();
      svg.selectAll('*').remove();
      if (!rows || !rows.length || !rate) { svg.attr('height', 40); return; }
      const W = el.clientWidth - 2 * 16 || 600, H = Math.max(280, Math.min(460, W * 0.62));
      const pctM = MONEY[p.money].pct;
      const fx = (v) => pctM ? BG.pct(v, 0) : (v === 0 ? '$0' : v >= 1e9 ? '$' + d3.format('~g')(v / 1e9) + 'B' : '$' + d3.format('~g')(v / 1e6) + 'M');
      const xMax = d3.max(rows, (r) => r.money), yMax = d3.max(rows, (r) => r.perf);
      const x0 = d3.scaleLinear().domain([0, xMax * 1.05]).nice(), y0 = d3.scaleLinear().domain([0, yMax * 1.08]).nice();
      svg.attr('viewBox', null); // measure in plain pixels, not the previous drawing's scale
      const tmp = svg.append('g').attr('class', 'axis');
      const yt = y0.ticks(5).map((t) => { const n = tmp.append('text').text(BG.tick(t)); const w = n.node().getComputedTextLength(); n.remove(); return w; });
      tmp.remove();
      const m = { top: 10, right: 14, bottom: 34, left: Math.ceil(d3.max(yt) || 30) + 12 };
      svg.attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', null).attr('aria-label', `Scatter of ${rows.length} quarterbacks, ${MONEY[p.money].label} against ${PERF[p.perf].label}`);
      const x = x0.range([m.left, W - m.right]), y = y0.range([H - m.bottom, m.top]);
      svg.append('g').attr('class', 'grid').selectAll('line').data(y.ticks(5)).join('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y).attr('y2', y);
      svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.bottom})`).call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(W / 110))).tickFormat(fx));
      svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(BG.tick));
      svg.append('text').attr('class', 'lbl').attr('x', W - m.right).attr('y', H - 4).attr('text-anchor', 'end').style('fill', 'var(--color-fg-muted)').text(MONEY[p.money].label + ' →');
      // league rate line: perf = money / rate * scale
      const scale = PERF[p.perf].scale;
      const slope = (v) => v / rate.rate * scale;
      const xEnd = Math.min(x.domain()[1], rate.rate * y.domain()[1] / scale);
      // motion explains change: glide only when the axes keep their meaning (same money, production, games, width)
      const unit = [p.money, p.perf, p.part].join('|'), size = W + 'x' + H, D = BG.dur(450);
      const resized = el.__unit === unit && el.__size !== size; // just a resize: redraw in place, no motion
      const prev = el.__unit === unit && !resized ? el.__pos : null;
      const line = svg.append('line').attr('x1', x(0)).attr('y1', y(0)).attr('x2', x(xEnd)).attr('y2', y(slope(xEnd)))
        .style('stroke', 'var(--color-fg-muted)').style('stroke-dasharray', '5 4').style('stroke-width', 1.5);
      if (D && prev && prev.line) line.attr('x2', prev.line[0]).attr('y2', prev.line[1]).transition().duration(D).ease(BG.EASE).attr('x2', x(xEnd)).attr('y2', y(slope(xEnd)));
      svg.append('text').attr('class', 'lbl').attr('x', m.left + 4).attr('y', m.top + 10).style('fill', 'var(--color-fg-muted)').text('↑ ' + PERF[p.perf].label);
      const bag = (r) => BG.isBag(r, rate, p);
      const dots = svg.append('g').selectAll('circle').data(rows, (r) => r.player_url).join('circle')
        .attr('cx', (r) => x(r.money)).attr('cy', (r) => y(Math.max(0, r.perf))).attr('r', W < 500 ? 4 : 5)
        .style('fill', (r) => bag(r) ? 'var(--bg-accent)' : 'var(--color-fg-muted)').style('fill-opacity', (r) => bag(r) ? 0.85 : 0.25)
        .style('stroke', (r) => bag(r) ? 'var(--bg-accent)' : 'var(--color-fg-muted)').style('stroke-width', 0.8).style('cursor', 'pointer');
      const at = (r) => [x(r.money), y(Math.max(0, r.perf))];
      if (D && prev) {
        dots.filter((r) => prev.has(r.player_url))
          .attr('cx', (r) => prev.get(r.player_url)[0]).attr('cy', (r) => prev.get(r.player_url)[1])
          .transition().duration(D).ease(BG.EASE).attr('cx', (r) => at(r)[0]).attr('cy', (r) => at(r)[1]);
        dots.filter((r) => !prev.has(r.player_url)).style('opacity', 0).transition().delay(D * 0.4).duration(D * 0.6).style('opacity', 1);
      } else if (D && !resized) {
        dots.style('opacity', 0).transition().duration(260).style('opacity', 1);
      }
      el.__unit = unit; el.__size = size;
      el.__pos = new Map(rows.map((r) => [r.player_url, at(r)]));
      el.__pos.line = [x(xEnd), y(slope(xEnd))];
      // label the 5 furthest below the line (largest shortfall vs expected production)
      const short = rows.filter(bag).map((r) => ({ r, gap: BG.inv(p) ? r.perf - slope(r.money) : slope(r.money) - r.perf })).sort((a, b) => b.gap - a.gap).slice(0, W < 500 ? 3 : 5);
      const placed = [];
      for (const { r } of short) {
        let ly = y(Math.max(0, r.perf)) - 8;
        while (placed.some((q) => Math.abs(q - ly) < 13)) ly -= 13;
        placed.push(ly);
        const anchor = x(r.money) > W * 0.7 ? 'end' : 'start';
        const t = svg.append('text').attr('class', 'lbl bg-qblink-svg').attr('x', x(r.money) + (anchor === 'end' ? -7 : 7)).attr('y', ly).attr('text-anchor', anchor)
          .style('paint-order', 'stroke').style('stroke', 'var(--color-panel)').style('stroke-width', 3).style('stroke-linejoin', 'round')
          .attr('tabindex', 0).attr('role', 'link').attr('aria-label', 'Open ' + r.player + ' breakdown')
          .on('click', () => BG.open(r.player_url))
          .on('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); BG.open(r.player_url); } });
        BG.svgName(t, r.player);
      }
      const show = (event, r) => {
        tip.attr('hidden', null).html('');
        tip.append('b').text(r.player);
        tip.append('div').text(r.team + ' · ' + (r.first === r.last ? r.first : r.first + '–' + r.last));
        tip.append('div').text(MONEY[p.money].short + ': ' + BG.fmtMoney(r.money));
        tip.append('div').text(PERF[p.perf].short + ': ' + BG.num(r.perf, BG.dec(p.perf)));
        tip.append('div').text(BG.unit(r.per_unit, p));
        tip.append('div').style('color', 'var(--color-fg-muted)').text('Tap for breakdown ›');
        const [mx, my] = d3.pointer(event, el);
        const tw = tip.node().offsetWidth, th = tip.node().offsetHeight;
        tip.style('left', Math.max(4, Math.min(el.clientWidth - tw - 4, mx + 12)) + 'px').style('top', Math.max(4, my - th - 10) + 'px');
      };
      dots.on('pointerenter pointermove', show).on('pointerleave', () => tip.attr('hidden', true)).on('click', (e, r) => BG.open(r.player_url));
    }
  });

  // ---- dead cap chart ----
  dash.draw('deadchart', {
    mount: (el) => ({ svg: d3.select(el).append('svg').attr('role', 'img'), tip: d3.select(el).append('div').attr('class', 'bg-tip').attr('hidden', true) }),
    update: (el, { svg, tip }) => {
      const L = dash.data('leaders'), p = P();
      svg.selectAll('*').remove();
      el.querySelectorAll('.bg-empty').forEach((n) => n.remove());
      if (L.status !== 'ok' || !Array.isArray(L.data)) { svg.attr('height', 40); return; }
      const rows = L.data.filter((r) => r.eligible && r.dead > 0).sort((a, b) => b.dead - a.dead).slice(0, (el.clientWidth || 600) < 532 ? 8 : 12);
      if (!rows.length) { svg.attr('height', 0); const e = document.createElement('p'); e.className = 'bg-empty'; e.textContent = 'No dead cap in this selection.'; el.append(e); return; }
      const W = el.clientWidth - 32 || 600, rowH = 30, labelW = Math.min(150, W * 0.36), valW = W < 500 ? 70 : 150;
      const H = rows.length * rowH + 24;
      svg.attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', null).attr('aria-label', `Top ${rows.length} quarterbacks by dead cap left behind`);
      const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.dead)]).range([labelW, W - valW]);
      const g = svg.append('g').selectAll('g').data(rows).join('g').attr('class', 'bg-qrow').attr('transform', (r, i) => `translate(0,${i * rowH + 4})`).style('cursor', 'pointer')
        .on('click', (e, r) => BG.open(r.player_url));
      g.append('text').attr('class', 'lbl bg-qblink-svg').attr('x', labelW - 8).attr('y', 15).attr('text-anchor', 'end')
        .each(function (r) { const t = BG.svgName(d3.select(this), r.player); if (this.getComputedTextLength() > labelW - 8) BG.svgName(t, r.player.replace(/^(\S)\S*\s+/, '$1. ')); });
      g.append('rect').attr('x', labelW).attr('y', 4).attr('height', 16).attr('rx', 2).attr('width', (r) => Math.max(2, x(r.dead) - labelW))
        .style('fill', (r, i) => i ? 'color-mix(in srgb, var(--bg-accent) 22%, transparent)' : 'var(--bg-accent)').style('stroke', 'var(--bg-accent)').style('stroke-width', 1);
      g.append('text').attr('class', 'lbl').attr('x', (r) => x(r.dead) + 6).attr('y', 15)
        .text((r) => BG.money(r.dead) + (W < 500 ? '' : ' · ' + BG.num(r.perf, BG.dec(p.perf)) + ' ' + PERF[p.perf].word));
      const D = BG.dur(450), prev = el.__W === W ? el.__bars : null;
      if (D && prev) {
        const old = (r) => prev.get(r.player_url);
        const rank = new Map(rows.map((r, i) => [r.player_url, i]));
        g.filter((r) => old(r)).attr('transform', (r) => `translate(0,${old(r).y})`)
          .transition().duration(D).ease(BG.EASE).attr('transform', (r) => `translate(0,${rank.get(r.player_url) * rowH + 4})`);
        g.filter((r) => old(r)).select('rect').attr('width', (r) => old(r).w).transition().duration(D).ease(BG.EASE).attr('width', (r) => Math.max(2, x(r.dead) - labelW));
        g.filter((r) => old(r)).select('text:last-of-type').attr('x', (r) => old(r).w + labelW + 6).transition().duration(D).ease(BG.EASE).attr('x', (r) => x(r.dead) + 6);
        g.filter((r) => !old(r)).style('opacity', 0).transition().delay(D * 0.4).duration(D * 0.6).style('opacity', 1);
      }
      el.__W = W;
      el.__bars = new Map(rows.map((r, i) => [r.player_url, { y: i * rowH + 4, w: Math.max(2, x(r.dead) - labelW) }]));
      g.on('pointerenter pointermove', (event, r) => {
        tip.attr('hidden', null).html('');
        tip.append('b').text(r.player);
        tip.append('div').text('Dead cap: ' + BG.money(r.dead));
        tip.append('div').text('Paid out as dead money: ' + BG.money(r.dead_cash));
        tip.append('div').text(PERF[p.perf].short + ' in these seasons: ' + BG.num(r.perf, BG.dec(p.perf)));
        if (r.perf > 0) tip.append('div').text('Dead cap per ' + PERF[p.perf].per + ': ' + BG.money(r.dead / (r.perf / PERF[p.perf].scale)));
        const [mx, my] = d3.pointer(event, el);
        const tw = tip.node().offsetWidth, th = tip.node().offsetHeight;
        tip.style('left', Math.max(4, Math.min(el.clientWidth - tw - 4, mx + 12)) + 'px').style('top', Math.max(4, my - th - 10) + 'px');
      }).on('pointerleave', () => tip.attr('hidden', true));
    }
  });

  // ---- quarterback picker ----
  dash.draw('pick', (sel) => {
    const pl = dash.data('players');
    const rows = pl.status === 'ok' && Array.isArray(pl.data) ? pl.data.filter((r) => r.has_season_history).sort((a, b) => a.player.localeCompare(b.player)) : [];
    sel.replaceChildren(new Option(rows.length ? 'Choose a quarterback' : 'Loading…', ''), ...rows.map((r) => new Option(r.player, r.player_url)));
    sel.value = P().qb || '';
    sel.onchange = () => { if (sel.value) BG.open(sel.value); else dash.setParams({ qb: '' }); };
  });

  // ---- playoffs ----
  dash.draw('po-th-money', (el) => { el.textContent = MONEY[P().money].short; });
  dash.draw('po-note', (el) => {
    const L = dash.data('leaders'), p = P();
    if (L.status !== 'ok' || !Array.isArray(L.data)) { el.textContent = '—'; return; }
    const rows = L.data.filter((r) => r.eligible && r.po_starts > 0);
    const w = d3.sum(rows, (r) => r.po_wins), l = d3.sum(rows, (r) => r.po_losses);
    el.textContent = BG.num(rows.length) + ' quarterbacks in your selection started a playoff game during ' + range(p) + ' (' + BG.wl(w, l) + ' combined). Money is the whole seasons they were paid, so "per playoff win" shows how much of a season’s pay each postseason win cost. Ignores the attempts minimum.';
  });
  dash.draw('po-table', BG.flipDraw((tb) => {
    const L = dash.data('leaders'), p = P();
    tb.replaceChildren();
    if (L.status !== 'ok' || !Array.isArray(L.data)) return;
    const key = p.posort;
    const rows = L.data.filter((r) => r.eligible && r.po_starts > 0 && (key !== 'per_po_win' || r.per_po_win != null))
      .sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity) || b.po_starts - a.po_starts).slice(0, 25);
    if (!rows.length) { const td = tb.insertRow().insertCell(); td.colSpan = 8; td.className = 'bg-empty'; td.textContent = 'No playoff starts in this selection.'; return; }
    rows.forEach((r, i) => {
      const tr = tb.insertRow(); tr.className = 'bg-row'; tr.dataset.key = r.player_url; tr.tabIndex = 0;
      tr.onclick = () => BG.open(r.player_url);
      tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); BG.open(r.player_url); } };
      const add = (t, cls) => { const td = tr.insertCell(); if (cls) td.className = cls; td.textContent = t; return td; };
      add(i + 1, 'bg-rank');
      const n = add('', 'bg-name'); n.append(BG.span(r.player, null, null, null, 'bg-qblink')); const m = document.createElement('span'); m.className = 'bg-meta'; m.textContent = r.team + ' · ' + (r.first === r.last ? r.first : r.first + '–' + r.last); n.append(m);
      add(BG.fmtMoney(r.money), 'num');
      add(BG.wl(r.po_wins, r.po_losses), 'num');
      add(BG.pct(100 * r.po_wins / r.po_starts, 0), 'num bg-hide-sm');
      add(BG.num(r.po_wpa, 2), 'num bg-hide-sm');
      add(r.per_po_win == null ? 'No wins' : BG.fmtMoney(r.per_po_win), 'num');
      add(BG.wl(r.wins, r.losses, r.ties), 'num bg-hide-sm');
    });
  }));

  // ---- contracts table ----
  dash.draw('ctable', (tb) => {
    const C = dash.data('contracts'), p = P();
    tb.replaceChildren();
    if (C.status === 'error') { const td = tb.insertRow().insertCell(); td.colSpan = 7; td.className = 'bg-empty'; td.textContent = 'The contract data didn’t load.'; return; }
    if (C.status !== 'ok') return;
    const key = p.csort;
    const classOk = (c) => p.mode === 'all' || (p.mode === 'rookie' ? c === 'rookie' : c !== 'rookie');
    const rows = C.data.filter((c) => c.year_signed >= +p.from && c.year_signed <= +p.to && classOk(c.contract_class) && c.contract_type !== 'Practice' && c[key] != null)
      .sort((a, b) => b[key] - a[key]);
    // a traded deal appears once per team; keep its first row
    const seen = new Set(), out = [];
    for (const c of rows) { const k = c.player_url + '|' + c.year_signed + '|' + c.total; if (seen.has(k)) continue; seen.add(k); out.push(c); if (out.length >= 25) break; }
    if (!out.length) { const td = tb.insertRow().insertCell(); td.colSpan = 7; td.className = 'bg-empty'; td.textContent = 'No contracts signed in these seasons.'; return; }
    out.forEach((c, i) => {
      const tr = tb.insertRow(); tr.className = 'bg-row'; tr.dataset.key = c.contract_id; tr.tabIndex = 0;
      tr.onclick = () => BG.open(c.player_url);
      tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); BG.open(c.player_url); } };
      const r0 = tr.insertCell(); r0.className = 'bg-rank'; r0.textContent = i + 1;
      const r1 = tr.insertCell(); r1.className = 'bg-name'; r1.append(BG.span(c.player, null, null, null, 'bg-qblink'));
      const m = document.createElement('span'); m.className = 'bg-meta'; m.textContent = c.team + ' · ' + c.contract_type + ' · ' + c.year_signed + ', ' + c.yrs + ' yr' + (c.yrs === 1 ? '' : 's');
      if (key !== 'apy' && key !== 'apy_pct_of_cap' && key !== 'inflated_apy' && key !== 'pct_earned') m.textContent += ' · ' + ({ inflated_total: 'Total ', inflated_guarantees: 'Guaranteed ', effective_apy: 'Effective APY ', amount_earned: 'Earned ' }[key]) + BG.money(c[key]) + (key.startsWith('inflated') ? ' (2026 $)' : '');
      r1.append(m);
      const r2 = tr.insertCell(); r2.className = 'num bg-hide-sm'; r2.textContent = c.year_signed;
      const r3 = tr.insertCell(); r3.className = 'num bg-hide-sm'; r3.textContent = BG.money(c.apy);
      const r4 = tr.insertCell(); r4.className = 'num'; r4.textContent = BG.pct(c.apy_pct_of_cap);
      const r5 = tr.insertCell(); r5.className = 'num'; r5.textContent = BG.money(c.inflated_apy);
      const r6 = tr.insertCell(); r6.className = 'num bg-hide-sm'; r6.textContent = c.pct_earned == null ? '—' : BG.pct(c.pct_earned);
    });
  });
})();
