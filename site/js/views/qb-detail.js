(function () {
  const { P, MONEY, PERF } = BG;
  const mine = (id) => { const d = dash.data(id), q = P().qb; return d.status === 'ok' && Array.isArray(d.data) && q ? d.data.filter((r) => r.player_url === q) : null; };
  const inWin = (r) => { const p = P(); return r.year >= +p.from && r.year <= +p.to && (p.mode === 'all' || (p.mode === 'rookie' ? r.contract_class === 'rookie' : r.contract_class !== 'rookie')); };

  dash.draw('qb-name', (el) => {
    const pl = mine('players');
    el.textContent = pl && pl[0] ? pl[0].player : '—';
  });
  dash.draw('qb-entry', (el) => {
    const pl = mine('players');
    if (!pl || !pl[0]) { el.textContent = '—'; return; }
    const r = pl[0], w = BG.where(r.player_url);
    const parts = [];
    el.replaceChildren(
      BG.span(r.entry || 'Entry unknown', 'players', 'entry', w),
      r.college ? ' · ' + r.college : '',
      ' · Career earnings ', BG.span(BG.money(r.career_earnings), 'players', 'career_earnings', w)
    );
    if (r.current_contract) el.append(' · Current deal: ' + r.current_contract);
    if (r.current_team) el.append(' · Now with the ' + r.current_team + (r.current_week ? ' (week ' + r.current_week + ')' : ''));
  });

  function qbTotals() {
    const L = dash.data('leaders'), q = P().qb;
    if (L.status !== 'ok' || !Array.isArray(L.data)) return null;
    return L.data.find((r) => r.player_url === q) || null;
  }

  dash.draw('qb-tiles', (el) => {
    const r = qbTotals(), p = P();
    el.replaceChildren();
    if (!r) { const e = document.createElement('p'); e.className = 'bg-empty'; e.textContent = 'No paid seasons for this quarterback in your selection. Widen the seasons or contract filter to see totals.'; el.append(e); return; }
    const w = BG.where(r.player_url);
    const tiles = [
      ['Cash paid', BG.money(r.cash), 'cash'],
      ['In ' + BG.capYear + ' cap $', BG.money(r.cash_adj), 'cash_adj'],
      ['Share of team cap', BG.pct(r.cap_share), 'cap_share'],
      ['Dead cap left behind', BG.money(r.dead), 'dead'],
      [PERF[p.perf].label + (PERF[p.perf].part ? ' (' + BG.PART[p.part] + ')' : ''), BG.num(r.perf, BG.dec(p.perf)), 'perf'],
      [MONEY[p.money].short + ' per ' + PERF[p.perf].per, r.per_unit == null ? '—' : BG.unit(r.per_unit, p).split(' / ')[0], 'per_unit'],
      ['Passer rating', BG.num(r.passer_rating, 1), 'passer_rating'],
      ['Record as starter', BG.wl(r.wins, r.losses, r.ties), 'wins'],
      ['Playoff record', r.po_starts ? BG.wl(r.po_wins, r.po_losses) : 'None', 'po_wins'],
      ['Super Bowls (won / started)', r.sb_starts ? BG.num(r.sb_wins) + ' / ' + BG.num(r.sb_starts) : 'None', 'sb_wins'],
      ['Seasons as primary starter', BG.num(r.starter_seasons), 'starter_seasons'],
      ['WPA (reg / playoffs)', BG.num(r.wpa, 1) + ' / ' + BG.num(r.po_wpa, 1), 'wpa'],
      ['Turnovers (reg / playoffs)', BG.num(r.turnovers) + ' / ' + BG.num(r.po_turnovers), 'turnovers']
    ];
    for (const [label, val, field] of tiles) {
      const d = document.createElement('div'); d.className = 'bg-tile';
      d.append(BG.span(label, null, null, null, 'bg-tile-label'), BG.span(val, 'leaders', field, w, 'bg-big'));
      el.append(d);
    }
  });

  dash.draw('qb-verdict', (el) => {
    const r = qbTotals(), rate = BG.rate(), p = P();
    if (!r || !rate || r.per_unit == null || !rate.rate) { el.textContent = ''; return; }
    const ratio = r.per_unit / rate.rate;
    const rows = BG.ranked() || [];
    const rank = BG.bagSort(rows, p).findIndex((x) => x.player_url === r.player_url);
    const word = BG.inv(p) ? (ratio >= 1 ? ratio.toFixed(1) + '× the league rate (fewer turnovers for the money)' : Math.round((1 - ratio) * 100) + '% below the league rate (more turnovers for the money)') : ratio >= 1 ? (ratio).toFixed(1) + '× the league rate' : Math.round((1 - ratio) * 100) + '% below the league rate';
    el.textContent = `${r.player} cost ${BG.unit(r.per_unit, p)} in ${p.from === p.to ? p.from : p.from + '–' + p.to}, ${word}` +
      (rank >= 0 ? `, ranking ${rank + 1} of ${rows.length} for bag getting.` : ' (not ranked: below the attempts minimum).');
  });

  function seasonChart(el, made, valueOf, fmt, colorOf, label) {
    const { svg, tip } = made;
    svg.selectAll('*').remove();
    const rows = mine('seasons');
    if (!rows || !rows.length) { svg.attr('height', 30); return; }
    rows.sort((a, b) => a.year - b.year);
    const W = el.clientWidth || 600, H = 180, m = { top: 8, right: 8, bottom: 22, left: 52 };
    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', null).attr('aria-label', label);
    const x = d3.scaleBand().domain(rows.map((r) => r.year)).range([m.left, W - m.right]).padding(0.2);
    const vals = rows.map(valueOf).filter((v) => v != null);
    if (!vals.some((v) => v)) { svg.attr('height', 0); return; }
    const lo = Math.min(0, d3.min(vals) ?? 0), hi = Math.max(0, d3.max(vals) ?? 1);
    const y = d3.scaleLinear().domain([lo, hi || 1]).nice().range([H - m.bottom, m.top]);
    svg.append('g').attr('class', 'grid').selectAll('line').data(y.ticks(4)).join('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y).attr('y2', y);
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(fmt));
    const every = Math.ceil(rows.length / Math.max(1, Math.floor((W - m.left) / 42)));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${y(0)})`).call(d3.axisBottom(x).tickValues(rows.map((r) => r.year).filter((yv, i) => i % every === 0)).tickFormat((v) => "'" + String(v).slice(2)));
    svg.append('g').selectAll('rect').data(rows.filter((r) => valueOf(r) != null)).join('rect')
      .attr('x', (r) => x(r.year) + (x.bandwidth() - Math.min(x.bandwidth(), 36)) / 2).attr('width', Math.min(x.bandwidth(), 36))
      .attr('y', (r) => y(Math.max(0, valueOf(r)))).attr('height', (r) => Math.max(1, Math.abs(y(valueOf(r)) - y(0))))
      .attr('rx', 2).style('fill', colorOf).style('opacity', (r) => inWin(r) ? 1 : 0.3)
      .on('pointerenter pointermove', (event, r) => {
        tip.attr('hidden', null).html('');
        tip.append('b').text(r.year + ' · ' + r.team);
        tip.append('div').text('Cash ' + BG.money(r.cash_paid) + ' · cap hit ' + BG.money(r.cap_number) + (r.cap_pct != null ? ' (' + BG.pct(r.cap_pct) + ')' : ''));
        tip.append('div').text('Deal: ' + (r.contract_type || 'unknown') + (r.contract_class === 'rookie' ? ' (rookie)' : ''));
        if (r.stats_known) {
          tip.append('div').text(BG.num(r.games) + ' games · ' + BG.num(r.total_tds) + ' TD · ' + BG.num(r.passing_yards) + ' yds · ' + BG.num(r.total_epa, 1) + ' EPA');
          tip.append('div').text((r.starts ? BG.wl(r.wins, r.losses, r.ties) + ' as starter' : 'No starts') + (r.po_starts ? ' · playoffs ' + BG.wl(r.po_wins, r.po_losses) : '') + ' · WPA ' + BG.num(r.wpa, 2) + ' · ' + BG.num(r.turnovers) + ' TO');
        }
        else tip.append('div').text('No stats before 1999');
        const [mx, my] = d3.pointer(event, el);
        const tw = tip.node().offsetWidth, th = tip.node().offsetHeight;
        tip.style('left', Math.max(4, Math.min(el.clientWidth - tw - 4, mx + 12)) + 'px').style('top', Math.max(4, my - th - 10) + 'px');
      }).on('pointerleave', () => tip.attr('hidden', true));
  }
  const mountChart = (el) => ({ svg: d3.select(el).append('svg').attr('role', 'img'), tip: d3.select(el).append('div').attr('class', 'bg-tip').attr('hidden', true) });
  const dealColor = (r) => r.contract_class === 'rookie' ? 'var(--dd-rookie)' : r.contract_class === 'unknown' ? 'var(--dd-nodeal)' : 'var(--dd-veteran)';

  dash.draw('qb-money', { mount: mountChart, update: (el, made) => seasonChart(el, made, (r) => r.cash_paid, (v) => BG.money(v).replace('.00', ''), dealColor, 'Cash paid by season') });
  dash.draw('qb-perf-title', (el) => { const p = P(); el.textContent = BG.PERF[p.perf].label + ' by season' + (BG.PERF[p.perf].part ? ' (' + BG.PART[p.part] + ')' : ''); });
  dash.draw('qb-perf', { mount: mountChart, update: (el, made) => {
    const k = P().perf;
    const part = P().part, v = (r) => BG.perfOf(r, k, part);
    seasonChart(el, made, (r) => r.stats_known ? v(r) : null, BG.tick, (r) => (BG.PERF[k].inverse ? false : (v(r) || 0) < 0) ? 'var(--bg-accent)' : 'var(--cds-chart-muted, var(--color-fg-muted))', BG.PERF[k].label + ' by season');
  } });

  dash.draw('qb-seasons', (tb) => {
    const rows = mine('seasons');
    tb.replaceChildren();
    if (!rows) return;
    if (!rows.length) { const td = tb.insertRow().insertCell(); td.colSpan = 15; td.className = 'bg-empty'; td.textContent = 'Over The Cap has no season-by-season pay for this quarterback.'; return; }
    rows.sort((a, b) => b.year - a.year).forEach((r) => {
      const tr = tb.insertRow(); tr.dataset.key = r.player_url + ',' + r.year;
      if (!inWin(r)) tr.style.opacity = '0.55';
      const cells = [
        [r.year], [r.team, 'bg-hide-sm'], [null], [BG.money(r.cash_paid), 'num'], [BG.money(r.cap_number), 'num bg-hide-sm'], [BG.pct(r.cap_pct), 'num'],
        [r.stats_known ? BG.num(r.games) : '—', 'num bg-hide-sm'], [r.stats_known ? BG.num(r.total_tds) : '—', 'num'],
        [r.stats_known ? BG.num(r.passing_yards) : '—', 'num bg-hide-sm'], [r.stats_known ? BG.num(r.total_epa, 1) : '—', 'num'], [r.stats_known && r.has_stats ? BG.num(r.passer_rating, 1) : '—', 'num bg-hide-sm'],
        [r.stats_known ? (r.starts ? BG.wl(r.wins, r.losses, r.ties) : '0 starts') : '—', 'num'],
        [r.stats_known ? (r.po_starts ? BG.wl(r.po_wins, r.po_losses) : '—') : '—', 'num bg-hide-sm'],
        [r.stats_known ? BG.num(r.wpa, 2) : '—', 'num bg-hide-sm'], [r.stats_known ? BG.num(r.turnovers) : '—', 'num bg-hide-sm']
      ];
      cells.forEach(([t, cls], i) => {
        const td = tr.insertCell(); if (cls) td.className = cls;
        if (i === 2) { const c = document.createElement('span'); c.className = 'bg-chip ' + r.contract_class; c.textContent = r.contract_class === 'rookie' ? 'Rookie' : r.contract_class === 'unknown' ? 'Unknown' : (r.contract_type || 'Veteran'); td.append(c); }
        else td.textContent = t;
      });
    });
  });

  dash.draw('qb-contracts', (tb) => {
    const rows = mine('contracts');
    tb.replaceChildren();
    if (!rows) return;
    const list = rows.filter((c) => c.contract_type !== 'Practice').sort((a, b) => b.year_signed - a.year_signed);
    const practice = rows.length - list.length;
    if (!list.length) { const td = tb.insertRow().insertCell(); td.colSpan = 7; td.className = 'bg-empty'; td.textContent = 'No contracts on record.'; return; }
    for (const c of list) {
      const tr = tb.insertRow(); tr.dataset.key = c.contract_id;
      const vals = [[c.year_signed], [c.team], [null], [BG.money(c.apy), 'num'], [BG.pct(c.apy_pct_of_cap), 'num bg-hide-sm'], [BG.money(c.inflated_apy), 'num'], [BG.money(c.amount_earned), 'num bg-hide-sm']];
      vals.forEach(([t, cls], i) => {
        const td = tr.insertCell(); if (cls) td.className = cls;
        if (i === 2) { const s = document.createElement('span'); s.className = 'bg-chip ' + c.contract_class; s.textContent = c.contract_type + (c.status === 'Traded' ? ' (traded)' : ''); td.append(s); }
        else td.textContent = t;
      });
    }
    if (practice) { const td = tb.insertRow().insertCell(); td.colSpan = 7; td.className = 'bg-empty'; td.textContent = practice + ' practice-squad deal' + (practice === 1 ? '' : 's') + ' not shown.'; }
  });

  dash.draw('qb-dead', (ul) => {
    const rows = mine('dead_money');
    ul.replaceChildren();
    if (!rows) return;
    if (!rows.length) { const li = document.createElement('li'); li.className = 'bg-empty'; li.textContent = 'No dead cap on record.'; ul.append(li); return; }
    rows.sort((a, b) => a.year - b.year);
    let total = 0;
    for (const d of rows) {
      if (d.played_role) {
        // money paid while he was still playing there, before a mid-season move: not dead cap left behind
        const li = document.createElement('li'), left = document.createElement('span');
        left.append(d.team + ' ' + d.year, BG.span('paid while he played there, then ' + ({ traded: 'traded', released: 'released' }[d.exit] || 'moved on') + ' mid-season · not counted as dead cap', null, null, null, 'bg-meta'));
        li.append(left, BG.span(BG.money(d.cap_charge), null, null, null, 'num bg-meta'));
        ul.append(li);
        continue;
      }
      total += d.cap_charge || 0;
      const w = BG.where(d.player_url) + '&team=' + encodeURIComponent(d.team) + '&year=' + d.year;
      const li = document.createElement('li');
      const left = document.createElement('span');
      left.append(d.team + ' ' + d.year, BG.span((d.contract_type || 'deal unknown') + (d.cash_paid ? ' · paid ' + BG.money(d.cash_paid) : ''), null, null, null, 'bg-meta'));
      li.append(left, BG.span(BG.money(d.cap_charge), 'dead_money', 'cap_charge', w, 'num'));
      ul.append(li);
    }
    const li = document.createElement('li'); li.style.fontWeight = '600';
    li.append('Total', BG.span(BG.money(total), null, null, null, 'num'));
    ul.append(li);
  });

  // ---- current season, game by game ----
  dash.draw('qb-games-title', (el) => {
    const g = mine('game_log'), M = (dash.data('meta').data || [])[0];
    const season = g && g.length ? g[0].season : M && M.current_season;
    el.textContent = season ? season + ' season, game by game' : 'This season, game by game';
  });
  dash.draw('qb-games', (tb) => {
    const rows = mine('game_log'), wrap = tb.closest('.bg-games');
    tb.replaceChildren();
    if (wrap) wrap.classList.toggle('is-empty', !rows || !rows.length);
    if (!rows || !rows.length) return;
    rows.sort((a, b) => (a.season_type === b.season_type ? a.week - b.week : a.season_type === 'REG' ? -1 : 1));
    rows.forEach((g, i) => {
      if (g.moved || (i === 0 ? false : rows[i - 1].team !== g.team)) {
        const tr = tb.insertRow(); tr.className = 'bg-move';
        const td = tr.insertCell(); td.colSpan = 10;
        td.textContent = g.moved === 'traded' ? 'Traded to the ' + g.team + (g.moved_from ? ' by the ' + g.moved_from : '')
          : 'Signed with the ' + g.team + (g.moved_from ? ' after leaving the ' + g.moved_from : '');
      }
      const tr = tb.insertRow(); tr.dataset.key = g.player_url + ',' + g.season_type + g.week;
      const add = (t, c) => { const td = tr.insertCell(); td.textContent = t; if (c) td.className = c; return td; };
      add(g.season_type === 'POST' ? ({ 19: 'Wild card', 20: 'Divisional', 21: 'Conference', 22: 'Super Bowl' }[g.week] || 'Playoffs') : g.week);
      add((g.home === false ? '@ ' : g.home === true ? 'vs ' : '') + (g.opponent || '—'));
      const res = g.outcome ? g.outcome + ' ' + g.points_for + '-' + g.points_against : '—';
      add(g.started ? res : res + ' · off the bench', 'bg-res ' + (g.outcome === 'W' ? 'bg-res-w' : g.outcome === 'L' ? 'bg-res-l' : ''));
      add(BG.num(g.completions) + '/' + BG.num(g.attempts), 'num');
      add(BG.num(g.passing_yards), 'num'); add(BG.num(g.passing_tds), 'num'); add(BG.num(g.interceptions), 'num');
      add(BG.num(g.sacks), 'num bg-hide-sm');
      add(BG.num(g.rushing_yards) + (g.rushing_tds ? ' · ' + g.rushing_tds + ' TD' : ''), 'num bg-hide-sm');
      add(BG.num(g.epa, 1), 'num bg-hide-sm');
    });
  });
})();
