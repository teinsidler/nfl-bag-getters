(function () {
  const { P, MONEY } = BG;
  const range = (p) => +p.from === +p.to ? String(p.from) : p.from + '–' + p.to;
  const ROLES = [['starter', 'Primary starter'], ['spot', 'Spot starter'], ['backup', 'Backup (played)'], ['inactive', 'Didn’t play'], ['unknown', 'Role unknown'],
    ['dead_traded', 'Dead cap: traded away'], ['dead_cut', 'Dead cap: released or retired']];
  const ARRIVALS = [['homegrown', 'Drafted or rookie deal here'], ['signed', 'Signed as a free agent'], ['traded', 'Traded for'], ['unknown', 'Arrival unknown']];
  const ARR_LABEL = Object.fromEntries(ARRIVALS);
  const isDead = (role) => String(role).startsWith('dead');
  const EXIT_TXT = { traded: 'traded away', released: 'released', void: 'void years accelerated', retired: 'retired', other: 'other' };
  const DEALS = [['rookie', 'Rookie deal'], ['veteran', 'Veteran deal'], ['unknown', 'No deal on record']];
  const ROLE_LABEL = Object.fromEntries(ROLES), DEAL_LABEL = Object.fromEntries(DEALS);
  const ROLE_VAR = { starter: '--dd-starter', spot: '--dd-spot', backup: '--dd-backup', inactive: '--dd-inactive', unknown: '--dd-unknown', dead_traded: '--dd-dead', dead_cut: '--dd-dead2' };
  const DEAL_VAR = { rookie: '--dd-rookie', veteran: '--dd-veteran', unknown: '--dd-nodeal' };
  const ARR_VAR = { homegrown: '--dd-home', signed: '--dd-signed', traded: '--dd-tradedfor', unknown: '--dd-unknown' };
  // dead cap keeps its accent in every color mode; other money takes the chosen category's color
  const colorOf = (mode, key) => 'var(' + (isDead(key) ? ROLE_VAR[key] : mode === 'deal' ? DEAL_VAR[key] : mode === 'arrival' ? ARR_VAR[key] : ROLE_VAR[key]) + ')';
  const ckOf = (mode, r) => isDead(r.role) ? r.role : mode === 'deal' ? r.contract_class : mode === 'arrival' ? (r.arrival || 'unknown') : r.role;
  const CK_ORDER = [...ROLES, ...DEALS, ...ARRIVALS].map(([k]) => k);

  // one row per franchise: QB money in the window split by role, plus the team's record
  dash.calc('team_totals', {
    title: 'Quarterback money by team',
    description: 'Each franchise’s quarterback money over the seasons and contracts picked, split by the role it paid for, with the team’s record.',
    inputs: ['seasons', 'dead_money', 'team_seasons', 'meta'],
    params: ['mode', 'money', 'from', 'to'],
    fn: (seasons, deadMoney, teamSeasons, meta) => {
      const M = meta[0];
      const p = Object.assign({ mode: 'all', money: 'cash', from: M.first_stats_season, to: M.last_complete_season }, dash.params());
      const from = +p.from, to = +p.to, CAP = M.cap_current;
      const classOk = (c) => p.mode === 'all' || (p.mode === 'rookie' ? c === 'rookie' : c !== 'rookie');
      const sv = (s) => { const f = s.inflation_factor || 1; return Math.max(0, { cash: s.cash_paid, cash_adj: (s.cash_paid || 0) * f, cap: s.cap_number, cap_share: s.cap_pct, dead: 0 }[p.money] || 0); };
      const dv = (d) => { const f = d.inflation_factor || 1; return Math.max(0, { cash: d.cash_paid, cash_adj: (d.cash_paid || 0) * f, cap: d.cap_charge, cap_share: (d.cap_charge || 0) * f / CAP * 100, dead: d.cap_charge }[p.money] || 0); };
      const by = new Map();
      const get = (t) => { if (!by.has(t)) by.set(t, { franchise: t, total: 0, starter: 0, spot: 0, backup: 0, inactive: 0, unknown: 0, dead: 0, dead_traded: 0, dead_cut: 0, wins: 0, losses: 0, ties: 0, po_wins: 0, po_losses: 0, seasons: 0 }); return by.get(t); };
      for (const s of seasons) {
        if (!s.franchise || s.year < from || s.year > to || !classOk(s.contract_class)) continue;
        const v = sv(s), r = get(s.franchise), role = s.role || 'unknown';
        r[role] += v; r.total += v;
      }
      for (const d of deadMoney) {
        if (!d.franchise || d.year < from || d.year > to || !classOk(d.contract_class)) continue;
        const v = dv(d), r = get(d.franchise); r.dead += v; r.total += v; r[d.exit === 'traded' ? 'dead_traded' : 'dead_cut'] += v;
      }
      for (const t of teamSeasons) {
        if (t.year < from || t.year > to) continue;
        const r = get(t.franchise);
        r.wins += t.wins; r.losses += t.losses; r.ties += t.ties; r.po_wins += t.po_wins; r.po_losses += t.po_losses; r.seasons += 1;
      }
      return [...by.values()].map((r) => {
        for (const k of ['total', 'starter', 'spot', 'backup', 'inactive', 'unknown', 'dead', 'dead_traded', 'dead_cut']) r[k] = p.money === 'cap_share' ? Math.round(r[k] * 100) / 100 : Math.round(r[k]);
        return r;
      });
    }
  });

  // one row per quarterback × role × deal type for the chosen team (top-spending team when none picked)
  dash.calc('team_flows', {
    title: 'Quarterback money flows for one team',
    description: 'For the team picked: money by quarterback, the role it paid for (starter, backup, dead cap) and the deal type, over the seasons and contracts picked.',
    inputs: ['seasons', 'dead_money', 'meta'],
    params: ['mode', 'money', 'from', 'to', 'team'],
    fn: (seasons, deadMoney, meta) => {
      const M = meta[0];
      const p = Object.assign({ mode: 'all', money: 'cash', from: M.first_stats_season, to: M.last_complete_season, team: '' }, dash.params());
      const from = +p.from, to = +p.to, CAP = M.cap_current;
      const classOk = (c) => p.mode === 'all' || (p.mode === 'rookie' ? c === 'rookie' : c !== 'rookie');
      const sv = (s) => { const f = s.inflation_factor || 1; return Math.max(0, { cash: s.cash_paid, cash_adj: (s.cash_paid || 0) * f, cap: s.cap_number, cap_share: s.cap_pct, dead: 0 }[p.money] || 0); };
      const dv = (d) => { const f = d.inflation_factor || 1; return Math.max(0, { cash: d.cash_paid, cash_adj: (d.cash_paid || 0) * f, cap: d.cap_charge, cap_share: (d.cap_charge || 0) * f / CAP * 100, dead: d.cap_charge }[p.money] || 0); };
      const inS = seasons.filter((s) => s.franchise && s.year >= from && s.year <= to && classOk(s.contract_class));
      const inD = deadMoney.filter((d) => d.franchise && d.year >= from && d.year <= to && classOk(d.contract_class));
      let team = p.team;
      if (!team) {
        const tot = new Map();
        for (const s of inS) tot.set(s.franchise, (tot.get(s.franchise) || 0) + sv(s));
        for (const d of inD) tot.set(d.franchise, (tot.get(d.franchise) || 0) + dv(d));
        team = [...tot.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      }
      const by = new Map();
      const get = (url, name, role, deal, arrival) => {
        const id = url + '|' + role + '|' + deal + '|' + arrival;
        if (!by.has(id)) by.set(id, { flow_id: id, franchise: team, player_url: url, player: name, role, contract_class: deal, arrival, money: 0, seasons: 0, years: [], team_starts: 0, wins: 0, losses: 0, ties: 0, po_wins: 0, po_losses: 0, dead: 0, other_team_starts: 0, exits: [] });
        return by.get(id);
      };
      for (const s of inS) {
        if (s.franchise !== team) continue;
        const r = get(s.player_url, s.player, s.role || 'unknown', s.contract_class || 'unknown', s.arrival || 'unknown');
        r.money += sv(s); r.seasons += 1; r.years.push(s.year); r.team_starts += s.team_starts || 0;
        // record in this team's games only (a QB traded mid-season also started elsewhere)
        r.wins += s.team_wins || 0; r.losses += s.team_losses || 0; r.ties += s.team_ties || 0; r.po_wins += s.team_po_wins || 0; r.po_losses += s.team_po_losses || 0;
        r.other_team_starts += s.other_team_starts || 0;
      }
      for (const d of inD) {
        if (d.franchise !== team) continue;
        const r = get(d.player_url, d.player, d.exit === 'traded' ? 'dead_traded' : 'dead_cut', d.contract_class || 'unknown', 'gone');
        const v = dv(d); r.money += v; r.dead += d.cap_charge || 0; r.years.push(d.year); if (!r.exits.includes(d.exit)) r.exits.push(d.exit);
      }
      return [...by.values()].filter((r) => r.money > 0).map((r) => {
        r.money = p.money === 'cap_share' ? Math.round(r.money * 100) / 100 : Math.round(r.money);
        const ys = [...new Set(r.years)].sort(); r.first = ys[0]; r.last = ys[ys.length - 1]; delete r.years;
        r.exits = r.exits.join(', ');
        return r;
      });
    }
  });

  const flows = () => { const d = dash.data('team_flows'); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  const totals = () => { const d = dash.data('team_totals'); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  const curTeam = () => { const f = flows(); return P().team || (f && f[0] ? f[0].franchise : ''); };
  const fm = (v) => BG.fmtMoney(v);
  const short = (n, narrow) => narrow && n.length > 15 ? n.split(' ')[0][0] + '. ' + n.split(' ').slice(1).join(' ') : n;

  dash.draw('team-pick', (sel) => {
    const t = totals();
    const names = t ? t.map((r) => r.franchise).sort() : [];
    sel.replaceChildren(...(names.length ? names.map((n) => new Option(n, n)) : [new Option('Loading…', '')]));
    sel.value = curTeam();
    sel.onchange = () => dash.setParams({ team: sel.value });
  });
  dash.draw('team-title', (el) => { const p = P(), t = curTeam(); el.textContent = t ? t + ': where the quarterback money went, ' + range(p) : '—'; });
  dash.draw('team-th-money', (el) => { el.textContent = MONEY[P().money].short; });
  dash.draw('team-lede', (el) => {
    const f = flows(), p = P();
    if (!f) { el.textContent = '—'; return; }
    if (!f.length) { el.textContent = 'No quarterback money on record for this team in these seasons and contracts.'; return; }
    const qbs = new Set(f.map((r) => r.player_url)).size;
    el.textContent = MONEY[p.money].label + ' to ' + qbs + ' quarterback' + (qbs === 1 ? '' : 's') + ', traced from the deal type, through the role the money paid for, to each quarterback. Band widths are to scale. Pick one season by setting both season boxes to the same year.';
  });

  dash.draw('team-tiles', (el) => {
    const f = flows(), t = totals(), p = P();
    el.replaceChildren();
    if (!f || !t) return;
    const team = t.find((r) => r.franchise === curTeam());
    const tot = d3.sum(f, (r) => r.money), starter = d3.sum(f.filter((r) => r.role === 'starter'), (r) => r.money), dead = d3.sum(f.filter((r) => isDead(r.role)), (r) => r.money), tradedIn = d3.sum(f.filter((r) => r.arrival === 'traded'), (r) => r.money);
    const share = (v) => tot > 0 ? BG.pct(100 * v / tot, 0) : '—';
    const tiles = [
      ['Quarterback ' + MONEY[p.money].short.toLowerCase(), fm(tot), MONEY[p.money].label + ', ' + range(p)],
      ['Paid to primary starters', share(starter), fm(starter)],
      ['Dead cap for QBs gone', share(dead), fm(dead) + ' to quarterbacks no longer on the deal'],
      ['Paid to QBs traded for', share(tradedIn), fm(tradedIn) + ' to quarterbacks acquired by trade'],
      ['Team record', team ? BG.wl(team.wins, team.losses, team.ties) : '—', team ? 'Playoffs ' + BG.wl(team.po_wins, team.po_losses) : ''],
      ['Per team win', team && team.wins > 0 ? fm(tot / team.wins) : '—', 'Quarterback money ÷ regular-season wins']
    ];
    for (const [label, big, note] of tiles) {
      const d = document.createElement('div'); d.className = 'bg-card bg-tile';
      d.append(BG.span(label, null, null, null, 'bg-tile-label'), BG.span(big, null, null, null, 'bg-big'), BG.span(note, null, null, null, 'bg-tile-note'));
      el.append(d);
    }
  });

  // ---------- Sankey: deal type → role → quarterback ----------
  function layoutSankey(rows, W, colorMode) {
    const narrow = W < 500;
    const total = d3.sum(rows, (r) => r.money);
    // quarterback nodes: biggest first, small ones folded into "Other"
    const perQb = d3.rollups(rows, (v) => ({ money: d3.sum(v, (r) => r.money), player: v[0].player, roleMoney: d3.rollup(v, (w) => d3.sum(w, (r) => r.money), (r) => r.role) }), (r) => r.player_url)
      .map(([url, o]) => ({ url, ...o })).sort((a, b) => b.money - a.money);
    const maxQ = narrow ? 5 : 6;
    const kept = new Set(perQb.filter((q, i) => i < maxQ && q.money / total >= 0.03).map((q) => q.url));
    const rest = perQb.filter((q) => !kept.has(q.url)); if (rest.length === 1) kept.add(rest[0].url); // no "Other (1)" bucket
    const roleIdx = Object.fromEntries(ROLES.map(([k], i) => [k, i]));
    const qbKey = (r) => kept.has(r.player_url) ? r.player_url : '__other';
    const nOther = perQb.filter((q) => !kept.has(q.url)).length;

    const col0 = DEALS.map(([k, l]) => ({ id: 'd:' + k, key: k, label: l, col: 0, value: d3.sum(rows.filter((r) => r.contract_class === k), (r) => r.money) })).filter((n) => n.value > 0);
    const col1 = ROLES.map(([k, l]) => ({ id: 'r:' + k, key: k, label: l, col: 1, value: d3.sum(rows.filter((r) => r.role === k), (r) => r.money) })).filter((n) => n.value > 0);
    const dom = (q) => [...q.roleMoney.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const col2 = perQb.filter((q) => kept.has(q.url)).sort((a, b) => roleIdx[dom(a)] - roleIdx[dom(b)] || b.money - a.money)
      .map((q) => ({ id: 'q:' + q.url, key: q.url, url: q.url, label: short(q.player, narrow), full: q.player, col: 2, value: q.money }));
    if (nOther) col2.push({ id: 'q:__other', key: '__other', label: 'Other QBs (' + nOther + ')', full: nOther + ' other quarterbacks', col: 2, value: d3.sum(perQb.filter((q) => !kept.has(q.url)), (q) => q.money) });
    const nodes = new Map([...col0, ...col1, ...col2].map((n) => [n.id, n]));

    // links (deal→role, role→quarterback), each tagged so hovering a node lights its path
    const ck = (r) => ckOf(colorMode, r);
    const L1 = d3.rollups(rows, (v) => d3.sum(v, (r) => r.money), (r) => r.contract_class, (r) => r.role, ck)
      .flatMap(([deal, rs]) => rs.flatMap(([role, cs]) => cs.map(([c, value]) => ({ s: 'd:' + deal, t: 'r:' + role, value, ck: c, tags: ['d:' + deal, 'r:' + role, 'c:' + c] }))));
    const L2 = d3.rollups(rows, (v) => d3.sum(v, (r) => r.money), (r) => r.role, qbKey, ck)
      .flatMap(([role, qs]) => qs.flatMap(([q, cs]) => cs.map(([c, value]) => ({ s: 'r:' + role, t: 'q:' + q, value, ck: c, tags: ['r:' + role, 'q:' + q, 'c:' + c] }))));
    const links = [...L1, ...L2].filter((l) => l.value > 0);

    // geometry: one px-per-unit scale for the whole diagram
    const top = 30, plotH = narrow ? 300 : 380, gap0 = 16, gutter = 32, gap2 = 10, nodeW = 12;
    const k = Math.min(
      (plotH - gap0 * Math.max(0, col0.length - 1)) / total,
      (plotH - gutter * col1.length) / total,
      (plotH - gap2 * Math.max(0, col2.length - 1)) / total);
    const leftW = narrow ? 84 : 124, rightW = narrow ? 108 : 168;
    const x0 = leftW, x2 = W - rightW - nodeW, x1 = Math.round((x0 + x2) / 2);
    // stack each column; quarterback nodes keep a 28px label pitch; columns centre on the middle one
    const place = (col, x, gap, pitch = 0) => {
      let y = 0, prev = -Infinity;
      for (const n of col) {
        const h = n.value * k; let y0 = y;
        if (y0 + h / 2 < prev + pitch) y0 = prev + pitch - h / 2;
        n.x = x; n.y0 = y0; n.y1 = y0 + h; prev = y0 + h / 2; y = n.y1 + gap;
      }
      return y - gap;
    };
    const shift = (col, dy) => col.forEach((n) => { n.y0 += dy; n.y1 += dy; });
    const h0 = place(col0, x0, gap0), h1 = place(col1, x1, gutter), h2 = place(col2, x2, gap2, 28);
    const mid = top + gutter + h1 / 2;
    shift(col1, top + gutter); shift(col0, Math.max(top, mid - h0 / 2)); shift(col2, Math.max(top + 10, mid - h2 / 2));
    // stack ribbons inside each node in a consistent top-to-bottom order
    const yOf = (id) => nodes.get(id).y0, ckOrder = (l) => CK_ORDER.indexOf(l.ck);
    const outC = new Map(), inC = new Map();
    for (const l of links.slice().sort((a, b) => yOf(a.s) - yOf(b.s) || yOf(a.t) - yOf(b.t) || ckOrder(a) - ckOrder(b))) {
      const o = outC.get(l.s) ?? nodes.get(l.s).y0; l.sy0 = o; l.sy1 = o + l.value * k; outC.set(l.s, l.sy1);
    }
    for (const l of links.slice().sort((a, b) => yOf(a.t) - yOf(b.t) || yOf(a.s) - yOf(b.s) || ckOrder(a) - ckOrder(b))) {
      const o = inC.get(l.t) ?? nodes.get(l.t).y0; l.ty0 = o; l.ty1 = o + l.value * k; inC.set(l.t, l.ty1);
    }
    const H = Math.ceil(d3.max([...nodes.values()], (n) => Math.max(n.y1, (n.y0 + n.y1) / 2 + 14)) + 10);
    return { nodes, col0, col1, col2, links, total, x0, x1, x2, nodeW, H, top, narrow };
  }

  const ribbon = (l, L) => {
    const xs = L.nodes.get(l.s).x + L.nodeW, xt = L.nodes.get(l.t).x, mx = (xs + xt) / 2;
    // both control points on the midpoint x so the band leaves and arrives horizontally
    return `M${xs},${l.sy0}C${mx},${l.sy0} ${mx},${l.ty0} ${xt},${l.ty0}L${xt},${l.ty1}C${mx},${l.ty1} ${mx},${l.sy1} ${xs},${l.sy1}Z`;
  };

  dash.draw('sankey', {
    mount: (el) => ({ svg: d3.select(el).append('svg').attr('role', 'img'), tip: d3.select(el).append('div').attr('class', 'bg-tip').attr('hidden', true) }),
    update: (el, { svg, tip }) => {
      const rows = flows(), p = P();
      svg.selectAll('*').remove();
      el.querySelectorAll('.bg-empty').forEach((n) => n.remove());
      if (!rows) { svg.attr('height', 40); return; }
      if (!rows.length) { svg.attr('height', 0); const e = document.createElement('p'); e.className = 'bg-empty'; e.textContent = 'No quarterback money for this team in these seasons and contracts.'; el.append(e); return; }
      // three labelled columns need ~600px; narrower screens scroll the diagram inside its card
      const avail = el.clientWidth || 640, W = avail < 600 ? Math.max(avail, 480) : avail;
      const L = layoutSankey(rows, W, p.color);
      const pctOf = (v) => BG.pct(100 * v / L.total, 0);
      svg.attr('viewBox', `0 0 ${W} ${L.H}`).attr('height', null).attr('width', W > avail ? W : '100%').style('min-width', W > avail ? W + 'px' : null)
        .attr('aria-label', `${curTeam()} quarterback money ${range(p)}: ${fm(L.total)} split by deal type, role and quarterback`);
      // column eyebrows
      [[L.x0 + L.nodeW / 2, 'Deal type'], [L.x1 + L.nodeW / 2, 'Role on team'], [L.x2 + L.nodeW / 2, 'Quarterback']].forEach(([x, t]) =>
        svg.append('text').attr('class', 'dd-eyebrow').attr('x', x).attr('y', 10).attr('text-anchor', 'middle').text(t));
      // ribbons, then node bars, then labels
      const flowsG = svg.append('g');
      // dead-cap ribbons carry the accent and are painted last so they read on top
      const paths = flowsG.selectAll('path').data(L.links.slice().sort((a, b) => isDead(a.ck) - isDead(b.ck))).join('path').attr('class', 'dd-flow')
        .classed('dd-accent', (l) => isDead(l.ck)).attr('d', (l) => ribbon(l, L)).style('fill', (l) => colorOf(p.color, l.ck));
      const nodesArr = [...L.nodes.values()];
      svg.append('g').selectAll('rect').data(nodesArr).join('rect').attr('class', 'dd-node')
        .attr('x', (n) => n.x).attr('y', (n) => n.y0).attr('width', L.nodeW).attr('height', (n) => Math.max(0.5, n.y1 - n.y0));
      const lab = svg.append('g');
      for (const n of L.col0) {
        const cy = (n.y0 + n.y1) / 2;
        lab.append('text').attr('class', 'dd-name').attr('x', n.x - 8).attr('y', cy - 1).attr('text-anchor', 'end').text(n.label);
        lab.append('text').attr('class', 'dd-qty').attr('x', n.x - 8).attr('y', cy + 11).attr('text-anchor', 'end').text(fm(n.value) + ' · ' + pctOf(n.value));
      }
      for (const n of L.col1) { // centred in the gutter above the bar
        lab.append('text').attr('class', 'dd-name').attr('x', n.x + L.nodeW / 2).attr('y', n.y0 - 17).attr('text-anchor', 'middle').text(n.label);
        lab.append('text').attr('class', 'dd-qty').attr('x', n.x + L.nodeW / 2).attr('y', n.y0 - 6).attr('text-anchor', 'middle').text(fm(n.value) + ' · ' + pctOf(n.value));
      }
      for (const n of L.col2) { // layout keeps a 28px pitch, so labels sit at their bar's centre
        const cy = (n.y0 + n.y1) / 2;
        const t = lab.append('text').attr('class', n.url ? 'dd-name bg-qblink-svg' : 'dd-name').attr('x', n.x + L.nodeW + 8).attr('y', cy - 1).text(n.label);
        if (n.url) {
          // keep name + chevron inside the right label column; abbreviate the first name if it would overflow
          const room = W - (n.x + L.nodeW + 8) - 2;
          BG.svgName(t, n.label);
          if (t.node().getComputedTextLength() > room) BG.svgName(t, short(n.full, true));
          t.on('click', () => BG.open(n.url));
        }
        lab.append('text').attr('class', 'dd-qty').attr('x', n.x + L.nodeW + 8).attr('y', cy + 11).text(fm(n.value) + ' · ' + pctOf(n.value));
      }
      // interaction: hover lights a path, tap a quarterback opens their breakdown
      const focus = (tag) => { el.classList.toggle('dd-focus', !!tag); paths.classed('on', (l) => !!tag && l.tags.includes(tag)); };
      const place = (event) => {
        const [mx, my] = d3.pointer(event, el), tw = tip.node().offsetWidth, th = tip.node().offsetHeight;
        tip.style('left', Math.max(4, Math.min(el.clientWidth - tw - 4, mx + 12)) + 'px').style('top', Math.max(4, my - th - 10) + 'px');
      };
      const nameOf = (id) => { const n = L.nodes.get(id); return n.full || n.label; };
      paths.on('pointerenter pointermove', (event, l) => {
        focus(null); paths.classed('on', (x) => x === l); el.classList.add('dd-focus');
        tip.attr('hidden', null).html('');
        tip.append('b').text(nameOf(l.s) + ' → ' + nameOf(l.t));
        tip.append('div').text(fm(l.value) + ' · ' + pctOf(l.value) + ' of the team’s QB money');
        if (!isDead(l.ck) && p.color === 'deal') tip.append('div').text('Paid on a ' + DEAL_LABEL[l.ck].toLowerCase());
        if (!isDead(l.ck) && p.color === 'arrival') tip.append('div').text('Arrived: ' + (ARR_LABEL[l.ck] || l.ck).toLowerCase());
        place(event);
      }).on('pointerleave', () => { focus(null); tip.attr('hidden', true); })
        .on('click', (e, l) => { const n = L.nodes.get(l.t); if (n.url) BG.open(n.url); });
      const hits = svg.append('g').selectAll('rect').data(nodesArr).join('rect').attr('class', 'dd-hit')
        .attr('x', (n) => n.x - 6).attr('y', (n) => n.y0 - 2).attr('width', L.nodeW + 12).attr('height', (n) => Math.max(8, n.y1 - n.y0 + 4)).style('fill', 'transparent');
      hits.on('pointerenter pointermove', (event, n) => {
        focus(n.id);
        tip.attr('hidden', null).html('');
        tip.append('b').text(n.full || n.label);
        tip.append('div').text(fm(n.value) + ' · ' + pctOf(n.value) + ' of the team’s QB money');
        if (n.url) {
          const mine = rows.filter((r) => r.player_url === n.url);
          for (const r of mine) tip.append('div').text(ROLE_LABEL[r.role] + ', ' + DEAL_LABEL[r.contract_class].toLowerCase() + (isDead(r.role) ? (r.exits ? ' (' + r.exits.split(', ').map((x) => EXIT_TXT[x] || x).join(', ') + ')' : '') : ', ' + (ARR_LABEL[r.arrival] || 'arrival unknown').toLowerCase()) + ': ' + fm(r.money) + (r.first ? ' (' + (r.first === r.last ? r.first : r.first + '–' + r.last) + ')' : ''));
          const elsewhere = d3.sum(mine, (r) => r.other_team_starts);
          if (elsewhere) tip.append('div').text('Also started ' + elsewhere + ' game' + (elsewhere === 1 ? '' : 's') + ' for another team in these seasons (moved mid-season). Each season’s pay sits with one team.');
          tip.append('div').style('color', 'var(--color-fg-muted)').text('Tap for breakdown ›');
        }
        place(event);
      }).on('pointerleave', () => { focus(null); tip.attr('hidden', true); })
        .on('click', (e, n) => { if (n.url) BG.open(n.url); });
    }
  });

  dash.draw('sankey-legend', (el) => {
    const p = P(), rows = flows() || [];
    const live = rows.filter((r) => !isDead(r.role));
    const base = p.color === 'deal' ? DEALS.filter(([k]) => live.some((r) => r.contract_class === k))
      : p.color === 'arrival' ? ARRIVALS.filter(([k]) => live.some((r) => r.arrival === k))
      : ROLES.filter(([k]) => !isDead(k) && live.some((r) => r.role === k));
    const keys = [...base, ...ROLES.filter(([k]) => isDead(k) && rows.some((r) => r.role === k))];
    el.replaceChildren(...keys.map(([k, l]) => { const s = document.createElement('span'); const i = document.createElement('i'); i.className = 'sw-flow'; i.style.background = colorOf(p.color, k); s.append(i, l); return s; }));
  });
  dash.draw('sankey-aside', (el) => {
    const f = flows();
    if (!f || !f.length) { el.textContent = ''; return; }
    const tot = d3.sum(f, (r) => r.money), by = (k) => d3.sum(f.filter((r) => r.role === k), (r) => r.money);
    const pc = (v) => v / tot < 0.005 ? 'under 1%' : Math.round(100 * v / tot) + '%';
    const top = d3.rollups(f, (v) => d3.sum(v, (r) => r.money), (r) => r.player).sort((a, b) => b[1] - a[1])[0];
    const live = by('starter') + by('spot') + by('backup') + by('inactive') + by('unknown');
    const parts = [];
    if (live > 0) parts.push(pc(by('starter')) + ' of the money paid primary starters and ' + pc(by('spot') + by('backup') + by('inactive')) + ' paid spot starters, backups and quarterbacks who didn’t play.');
    const dt = by('dead_traded'), dc = by('dead_cut');
    if (dt + dc > 0) parts.push(pc(dt + dc) + ' was dead cap for quarterbacks already gone' + (dt > 0 && dc > 0 ? ': ' + fm(dt) + ' after trading them away, ' + fm(dc) + ' after releasing them or their retirement.' : dt > 0 ? ', all after trading them away.' : ', all after releases, retirements or void years.'));
    const ti = d3.sum(f.filter((r) => r.arrival === 'traded'), (r) => r.money);
    if (ti > 0) parts.push(pc(ti) + ' went to quarterbacks the team traded for.');
    parts.push(top[0] + ' drew the most: ' + fm(top[1]) + '.');
    const pp = P(), D = dash.data('dead_money');
    if ((pp.money === 'cash' || pp.money === 'cash_adj') && D.status === 'ok' && D.data.some((d) => d.franchise === curTeam() && d.year >= +pp.from && d.year <= +pp.to && d.cap_charge > 0 && !(d.cash_paid > 0)))
      parts.push('Some dead cap here, such as from trades, cost no new cash, so it only shows when Money is set to Cap cost.');
    el.textContent = parts.map((x) => x[0].toUpperCase() + x.slice(1)).join(' ');
  });

  dash.draw('team-table', (tb) => {
    const f = flows(), p = P();
    tb.replaceChildren();
    if (!f) return;
    if (!f.length) { const td = tb.insertRow().insertCell(); td.colSpan = 7; td.className = 'bg-empty'; td.textContent = 'No quarterback money for this team in these seasons.'; return; }
    const tot = d3.sum(f, (r) => r.money);
    const qbs = d3.rollups(f, (v) => v, (r) => r.player_url).map(([url, v]) => ({
      url, player: v[0].player, money: d3.sum(v, (r) => r.money), dead: d3.sum(v.filter((r) => isDead(r.role)), (r) => r.money),
      roles: d3.rollups(v.filter((r) => !isDead(r.role)), (w) => d3.sum(w, (r) => r.seasons), (r) => r.role),
      arrivals: [...new Set(v.filter((r) => !isDead(r.role)).map((r) => r.arrival))].map((a) => ARR_LABEL[a] || a),
      exits: [...new Set(v.flatMap((r) => r.exits ? r.exits.split(', ') : []))].map((x) => EXIT_TXT[x] || x),
      wins: d3.sum(v, (r) => r.wins), losses: d3.sum(v, (r) => r.losses), ties: d3.sum(v, (r) => r.ties), starts: d3.sum(v, (r) => r.team_starts),
      po_wins: d3.sum(v, (r) => r.po_wins), po_losses: d3.sum(v, (r) => r.po_losses)
    })).sort((a, b) => b.money - a.money);
    for (const q of qbs) {
      const tr = tb.insertRow(); tr.className = 'bg-row'; tr.tabIndex = 0;
      tr.onclick = () => BG.open(q.url);
      tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); BG.open(q.url); } };
      const add = (t, cls) => { const td = tr.insertCell(); if (cls) td.className = cls; td.textContent = t; return td; };
      add('', 'bg-name').append(BG.span(q.player, null, null, null, 'bg-qblink'));
      const roleTxt = q.roles.sort((a, b) => ROLES.findIndex(([k]) => k === a[0]) - ROLES.findIndex(([k]) => k === b[0])).map(([k, n]) => ROLE_LABEL[k].replace(' (played)', '') + ' ×' + n).join(', ');
      add([q.arrivals.join(' / '), roleTxt, q.exits.length ? 'dead cap: ' + q.exits.join(', ') : ''].filter(Boolean).join(' · ') || 'Dead cap only', 'bg-hide-sm');
      add(fm(q.money), 'num'); add(BG.pct(100 * q.money / tot, 0), 'num'); add(q.dead ? fm(q.dead) : '—', 'num bg-hide-sm');
      add(q.starts ? BG.wl(q.wins, q.losses, q.ties) : '—', 'num'); add(q.po_wins + q.po_losses ? BG.wl(q.po_wins, q.po_losses) : '—', 'num bg-hide-sm');
    }
  });

  dash.draw('teambars-title', (el) => { const p = P(); el.textContent = 'Quarterback ' + MONEY[p.money].label.toLowerCase() + ' by team, ' + range(p); });
  dash.draw('team-bars', {
    mount: (el) => ({ legend: d3.select(el).append('div').attr('class', 'bg-legend').style('margin-bottom', '8px'), svg: d3.select(el).append('svg').attr('role', 'img').attr('class', 'bg-tbar'), tip: d3.select(el).append('div').attr('class', 'bg-tip').attr('hidden', true) }),
    update: (el, { svg, tip, legend }) => {
      const t = totals(), p = P();
      svg.selectAll('*').remove(); legend.selectAll('*').remove();
      if (t) for (const [k, l] of ROLES) if (t.some((r) => r[k] > 0)) { const s = legend.append('span'); s.append('i').attr('class', 'sw-flow').style('background', colorOf('role', k)); s.append('span').text(l); }
      if (!t || !t.length) { svg.attr('height', 40); return; }
      const rows = t.filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
      const W = el.clientWidth - 32 || 600, rowH = 22, labelW = W < 500 ? 84 : 110, valW = W < 500 ? 56 : 80, H = rows.length * rowH + 8;
      svg.attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', null).attr('aria-label', `Quarterback money for ${rows.length} teams, split by role`);
      const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.total)]).range([0, W - labelW - valW]);
      const cur = curTeam();
      const g = svg.selectAll('g.row').data(rows).join('g').attr('class', (r) => 'row' + (r.franchise === cur ? ' sel' : '')).attr('transform', (r, i) => `translate(0,${i * rowH + 4})`)
        .on('click', (e, r) => { dash.setParams({ team: r.franchise }); const s = document.getElementById('teams'); if (s) s.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); });
      g.append('rect').attr('class', 'hit').attr('x', 0).attr('y', 0).attr('width', W).attr('height', rowH);
      g.append('text').attr('class', 'lbl').attr('x', labelW - 8).attr('y', 15).attr('text-anchor', 'end').text((r) => r.franchise);
      g.each(function (r) {
        let x0 = labelW;
        for (const [k] of ROLES) {
          if (!r[k]) continue;
          const w = x(r[k]);
          d3.select(this).append('rect').attr('x', x0).attr('y', 4).attr('width', Math.max(0, w)).attr('height', 14).style('fill', colorOf('role', k)).style('fill-opacity', r.franchise === cur ? 1 : 0.55).style('stroke', 'var(--color-panel)').style('stroke-width', 1);
          x0 += w;
        }
        d3.select(this).append('text').attr('class', 'lbl').attr('x', x0 + 6).attr('y', 15).text(fm(r.total));
      });
      g.on('pointerenter pointermove', (event, r) => {
        tip.attr('hidden', null).html('');
        tip.append('b').text(r.franchise + ' · ' + fm(r.total));
        for (const [k, l] of ROLES) if (r[k]) tip.append('div').text(l + ': ' + fm(r[k]) + ' (' + BG.pct(100 * r[k] / r.total, 0) + ')');
        tip.append('div').text('Record ' + BG.wl(r.wins, r.losses, r.ties) + ' · playoffs ' + BG.wl(r.po_wins, r.po_losses));
        const [mx, my] = d3.pointer(event, el), tw = tip.node().offsetWidth, th = tip.node().offsetHeight;
        tip.style('left', Math.max(4, Math.min(el.clientWidth - tw - 4, mx + 12)) + 'px').style('top', Math.max(4, my - th - 10) + 'px');
      }).on('pointerleave', () => tip.attr('hidden', true));
    }
  });
})();
