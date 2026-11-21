(function () {
  const SEL = { mode: 'all', money: 'cash', perf: 'total_tds', from: null, to: null, minatt: 500, sort: 'most', qb: '', csort: 'inflated_apy',
    view: 'qbs', part: 'reg', team: '', color: 'role', posort: 'po_wins', minstart: 0, sb: 'any' };
  window.BG = window.BG || {};
  const P = () => Object.assign({}, SEL, dash.params());
  BG.P = P;

  BG.MONEY = {
    cash: { label: 'Cash paid', short: 'Cash', pct: false },
    cash_adj: { label: 'Cash paid (2026 cap $)', short: '2026 $', pct: false },
    cap: { label: 'Cap cost', short: 'Cap cost', pct: false },
    cap_share: { label: 'Share of team cap', short: 'Cap share', pct: true },
    dead: { label: 'Dead cap', short: 'Dead cap', pct: false }
  };
  BG.PERF = {
    total_tds: { label: 'Total TDs', short: 'TDs', word: 'TDs', per: 'TD', scale: 1, one: 'TD' },
    passing_yards: { label: 'Passing yards', short: 'Yards', word: 'passing yards', per: '1,000 yards', scale: 1000 },
    total_epa: { label: 'Total EPA', short: 'EPA', word: 'EPA', per: 'EPA point', scale: 1 },
    starts: { label: 'Starts', short: 'Starts', word: 'starts', per: 'start', scale: 1, part: true, one: 'start' },
    wins: { label: 'Wins as starter', short: 'Wins', word: 'wins', per: 'win', scale: 1, part: true, one: 'win' },
    wpa: { label: 'Win probability added', short: 'WPA', word: 'WPA', per: 'WPA win', scale: 1, part: true, dec: 2 },
    turnovers: { label: 'Turnovers', short: 'TOs', word: 'turnovers', per: 'turnover', scale: 1, part: true, inverse: true, one: 'turnover' },
    games: { label: 'Games played', short: 'Games', word: 'games', per: 'game', scale: 1 },
    attempts: { label: 'Pass attempts', short: 'Attempts', word: 'pass attempts', per: '100 attempts', scale: 100 }
  };

  BG.money = (v) => {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e7) return s + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return s + '$' + Math.round(a / 1e3) + 'K';
    return s + '$' + Math.round(a);
  };
  BG.tick = (v) => Math.abs(v) >= 1000 ? d3.format('~s')(v) : d3.format('~g')(v);
  BG.pct = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d) + '%';
  BG.fmtMoney = (v, key) => BG.MONEY[key || P().money].pct ? BG.pct(v, v < 10 ? 2 : 1) : BG.money(v);
  BG.dec = (k) => k === 'total_epa' ? 1 : (BG.PERF[k] && BG.PERF[k].dec) || 0;
  BG.PART = { reg: 'regular season', post: 'playoffs', all: 'regular season and playoffs' };
  // value of a part-aware stat (wins, wpa, turnovers) for the "Games counted" choice
  BG.perfOf = (r, k, part) => {
    if (!BG.PERF[k] || !BG.PERF[k].part) return r[k];
    const a = r[k] || 0, b = r['po_' + k] || 0;
    return part === 'post' ? b : part === 'all' ? a + b : a;
  };
  BG.inv = (p) => !!BG.PERF[p.perf].inverse;
  BG.isBag = (r, rate, p) => BG.inv(p) ? r.per_unit < rate.rate : r.per_unit > rate.rate;
  // biggest bag getter first: most money per unit, or least money per unit for a stat where fewer is better
  BG.bagSort = (rows, p) => rows.slice().sort((a, b) => BG.inv(p) ? a.per_unit - b.per_unit : b.per_unit - a.per_unit);
  BG.wl = (w, l, t) => (w == null ? '—' : BG.num(w) + '-' + BG.num(l) + (t ? '-' + BG.num(t) : ''));
  BG.num = (v, d = 0) => (v == null || !isFinite(v)) ? '—' : d3.format(',.' + d + 'f')(v);
  BG.unit = (v, p) => {
    if (v == null || !isFinite(v)) return '—';
    const m = BG.MONEY[p.money];
    return (m.pct ? BG.pct(v, v < 1 ? 3 : 2) : BG.money(v)) + ' / ' + BG.PERF[p.perf].per;
  };


  dash.calc('leaders', {
    title: 'Quarterback pay vs production',
    description: 'One row per quarterback for the contracts and seasons picked on the page: money, production and money per unit of production.',
    inputs: ['seasons', 'dead_money', 'meta'],
    params: ['mode', 'money', 'perf', 'from', 'to', 'minatt', 'part', 'minstart', 'sb'],
    fn: (seasons, deadMoney, meta) => {
      const M = meta[0];
      const p = Object.assign({ mode: 'all', money: 'cash', perf: 'total_tds', from: M.first_stats_season, to: M.last_complete_season, minatt: 500, part: 'reg', minstart: 0, sb: 'any' }, dash.params());
      const PART_KEYS = ['starts', 'wins', 'wpa', 'turnovers'];
      const from = +p.from, to = +p.to, CAP = M.cap_current;
      const scale = { passing_yards: 1000, attempts: 100 }[p.perf] || 1;
      const classOk = (c) => p.mode === 'all' || (p.mode === 'rookie' ? c === 'rookie' : c !== 'rookie');
      const rating = (cmp, att, yds, td, ints) => {
        if (!att) return null;
        const c = (v) => Math.max(0, Math.min(2.375, v));
        return (c((cmp / att - 0.3) * 5) + c((yds / att - 3) * 0.25) + c(td / att * 20) + c(2.375 - ints / att * 25)) / 6 * 100;
      };
      const by = new Map();
      const get = (url, name) => {
        if (!by.has(url)) by.set(url, { player_url: url, player: name, seasons: 0, first: null, last: null, team: null,
          cash: 0, cash_adj: 0, cap: 0, cap_share: 0, dead: 0, dead_cash: 0,
          games: 0, attempts: 0, completions: 0, passing_yards: 0, passing_tds: 0, interceptions: 0, total_tds: 0, total_epa: 0,
          starts: 0, wins: 0, losses: 0, ties: 0, wpa: 0, turnovers: 0, po_starts: 0, po_wins: 0, po_losses: 0, po_wpa: 0, po_turnovers: 0,
          game_winning_drives: 0, sb_starts: 0, sb_wins: 0, starter_seasons: 0 });
        return by.get(url);
      };
      for (const s of seasons) {
        if (!s.stats_known || s.year < from || s.year > to || !classOk(s.contract_class)) continue;
        const r = get(s.player_url, s.player);
        r.seasons += 1;
        if (r.first == null || s.year < r.first) r.first = s.year;
        if (r.last == null || s.year >= r.last) { r.last = s.year; r.team = s.team; }
        const f = s.inflation_factor || 1;
        r.cash += s.cash_paid || 0; r.cash_adj += (s.cash_paid || 0) * f;
        r.cap += s.cap_number || 0; r.cap_share += s.cap_pct || 0;
        for (const k of ['games', 'attempts', 'completions', 'passing_yards', 'passing_tds', 'interceptions', 'total_tds', 'total_epa',
          'starts', 'wins', 'losses', 'ties', 'wpa', 'turnovers', 'po_starts', 'po_wins', 'po_losses', 'po_wpa', 'po_turnovers', 'game_winning_drives', 'sb_starts', 'sb_wins']) r[k] += s[k] || 0;
        if (s.role === 'starter') r.starter_seasons += 1;
      }
      for (const d of deadMoney) {
        if (d.year < from || d.year > to || !classOk(d.contract_class)) continue;
        // a charge can land after the QB left, in a season with no pay row of their own
        const r = get(d.player_url, d.player), f = d.inflation_factor || 1;
        if (r.team == null) { r.team = d.team; r.first = r.first ?? d.year; r.last = r.last ?? d.year; }
        r.dead += d.cap_charge || 0; r.dead_cash += d.cash_paid || 0;
        r.cash += d.cash_paid || 0; r.cash_adj += (d.cash_paid || 0) * f;
        r.cap += d.cap_charge || 0; r.cap_share += (d.cap_charge || 0) * f / CAP * 100;
      }
      const rows = [];
      for (const r of by.values()) {
        r.passer_rating = rating(r.completions, r.attempts, r.passing_yards, r.passing_tds, r.interceptions);
        if (r.passer_rating != null) r.passer_rating = Math.round(r.passer_rating * 10) / 10;
        r.total_epa = Math.round(r.total_epa * 10) / 10;
        r.wpa = Math.round(r.wpa * 100) / 100; r.po_wpa = Math.round(r.po_wpa * 100) / 100;
        r.cap_share = Math.round(r.cap_share * 100) / 100;
        r.cash_adj = Math.round(r.cash_adj);
        r.money = r[p.money];
        r.perf = PART_KEYS.includes(p.perf)
          ? (p.part === 'post' ? r['po_' + p.perf] : p.part === 'all' ? r[p.perf] + r['po_' + p.perf] : r[p.perf]) : r[p.perf];
        if (p.perf === 'wpa') r.perf = Math.round(r.perf * 100) / 100;
        r.per_po_win = r.po_wins > 0 && r.money > 0 ? Math.round(r.money / r.po_wins) : null;
        const floor = p.perf === 'wpa' ? 0.5 : 0; // tiny WPA totals would give absurd rates
        r.per_unit = r.perf > floor && r.money > 0 ? r.money / (r.perf / scale) : null;
        if (r.per_unit != null) r.per_unit = p.money === 'cap_share' ? Math.round(r.per_unit * 1000) / 1000 : Math.round(r.per_unit);
        // seasons-as-starter and Super Bowl filters (within the seasons picked)
        const sbOk = { any: true, played: r.sb_starts > 0, won: r.sb_wins > 0, won2: r.sb_wins >= 2, none: r.sb_starts === 0 }[p.sb] ?? true;
        r.eligible = r.starter_seasons >= +p.minstart && sbOk;
        r.ranked = r.eligible && r.per_unit != null && r.attempts >= +p.minatt;
        rows.push(r);
      }
      return rows;
    }
  });

  dash.calc('league', {
    title: 'League rate for the selection',
    description: 'Total money divided by total production across every ranked quarterback.',
    inputs: ['leaders'],
    params: ['perf', 'money'],
    fn: (leaders) => {
      const p = Object.assign({ perf: 'total_tds', money: 'cash' }, dash.params());
      const scale = { passing_yards: 1000, attempts: 100 }[p.perf] || 1;
      const ranked = (leaders || []).filter((r) => r.ranked);
      const money = d3.sum(ranked, (r) => r.money), perf = d3.sum(ranked, (r) => r.perf);
      const rate = perf > 0 ? money / (perf / scale) : null;
      return [{ qbs: ranked.length, money, perf, rate: rate == null ? null : (p.money === 'cap_share' ? Math.round(rate * 1000) / 1000 : Math.round(rate)) }];
    }
  });

  BG.ranked = () => {
    const L = dash.data('leaders');
    if (L.status !== 'ok' || !Array.isArray(L.data)) return null;
    const p = P();
    const rows = L.data.filter((r) => r.ranked);
    const bag = BG.bagSort(rows, p);
    return p.sort === 'least' ? bag.reverse() : bag;
  };
  BG.rate = () => {
    const g = dash.data('league');
    return g.status === 'ok' && g.data && g.data[0] ? g.data[0] : null;
  };
  BG.where = (url) => 'player_url=' + encodeURIComponent(url).replace(/%2F/g, '/').replace(/%3A/g, ':');
  // ---- motion: one place for timing, and none at all for people who ask for reduced motion ----
  BG.reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  BG.dur = (ms) => (BG.reduced() ? 0 : ms);
  BG.EASE = d3.easeCubicOut;
  // count a number to its new value when the unit is unchanged (same money/production/games); swap it otherwise
  BG.tween = (el, value, fmt, unit) => {
    const sel = d3.select(el), prev = el.__tv, same = el.__tu === unit;
    el.__tv = value; el.__tu = unit;
    if (value == null || !isFinite(value) || prev == null || !isFinite(prev) || !same || prev === value || BG.reduced()) {
      sel.interrupt('num'); el.textContent = fmt(value); return;
    }
    const i = d3.interpolateNumber(prev, value);
    sel.transition('num').duration(380).ease(BG.EASE).textTween(() => (t) => fmt(i(t)));
  };

  // where a quarterback was opened from, so closing the panel puts the reader back there
  let returnTo = null;
  BG.open = (url) => {
    if (!P().qb) {
      const a = document.activeElement, row = a && a.closest ? a.closest('tr.bg-row') : null;
      returnTo = { key: row ? row.dataset.key : null, where: row ? row.closest('[data-draw]').dataset.draw : null, y: window.scrollY };
    }
    dash.setParams({ qb: url });
    const el = document.getElementById('qb');
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: BG.reduced() ? 'auto' : 'smooth', block: 'start' }));
  };
  BG.close = () => {
    const back = returnTo; returnTo = null;
    dash.setParams({ qb: '' });
    if (!back) return;
    const box = back.where && document.querySelector('[data-draw="' + back.where + '"]');
    const row = box && !box.closest('[hidden]') ? [...box.querySelectorAll('tr.bg-row')].find((tr) => tr.dataset.key === back.key) : null;
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'auto' });
      row.focus({ preventScroll: true });
    } else {
      window.scrollTo({ top: back.y, behavior: 'auto' });
    }
  };
  // SVG QB name link: underlined name tspan + muted chevron tspan (text only, no markup)
  BG.svgName = (t, name) => { t.text(null); t.append('tspan').attr('class', 'bg-nm').text(name); t.append('tspan').attr('class', 'bg-chev').text(' ›'); return t; };
  BG.span = (text, source, field, where, cls) => {
    const s = document.createElement('span');
    s.textContent = text;
    if (source) { s.dataset.source = source; s.dataset.field = field; if (where) s.dataset.where = where; }
    if (cls) s.className = cls;
    return s;
  };

  // ---- controls: listen, and reflect current values (outside drawings only class/value/aria/hidden) ----
  const setP = (o) => dash.setParams(o);
  // segmented toggles: move the glass pill first, then redraw on the next frame so the pill never waits on the charts
  let pending = null;
  for (const k of ['mode', 'sort', 'view', 'part', 'color']) {
    document.querySelectorAll('[data-' + k + ']').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('[data-' + k + ']').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      pending = Object.assign(pending || {}, { [k]: b.dataset[k] });
      requestAnimationFrame(() => setTimeout(() => { if (pending) { const o = pending; pending = null; setP(o); } }, 0));
    }));
  }
  const sel = (id, name, num) => document.querySelectorAll('#' + id).forEach((el) => el.addEventListener('change', () => {
    const v = num ? Number(el.value) : el.value;
    const o = { [name]: v };
    if (name === 'from' && v > +P().to) o.to = v;
    if (name === 'to' && v < +P().from) o.from = v;
    setP(o);
  }));
  sel('money', 'money'); sel('perf', 'perf'); sel('from', 'from', true); sel('to', 'to', true); sel('minatt', 'minatt', true); sel('csort', 'csort'); sel('posort', 'posort'); sel('minstart', 'minstart', true); sel('sb', 'sb');
  document.querySelectorAll('#qb-close').forEach((b) => b.addEventListener('click', () => BG.close()));

  // years and "current cap dollars" wording come from data/meta.json
  let metaDone = false;
  const applyMeta = () => {
    const M = (dash.data('meta').data || [])[0];
    if (!M || metaDone) return;
    metaDone = true;
    const cy = String(M.current_season), inProgress = M.last_complete_season < M.current_season;
    BG.capYear = cy;
    BG.MONEY.cash_adj.label = 'Cash paid (' + cy + ' cap $)'; BG.MONEY.cash_adj.short = cy + ' $';
    document.querySelectorAll('[data-capyear]').forEach((el) => { el.textContent = cy; });
    document.querySelectorAll('[data-captext]').forEach((el) => { el.textContent = el.dataset.captext.replace('{y}', cy); });
    document.querySelectorAll('[data-inprogress]').forEach((el) => { el.hidden = !inProgress; });
    for (const sel of document.querySelectorAll('#from, #to')) {
      sel.replaceChildren();
      for (let y = M.first_stats_season; y <= M.current_season; y++) {
        const o = document.createElement('option'); o.value = String(y);
        o.textContent = y === M.current_season && inProgress ? y + ' (in progress)' : String(y);
        sel.append(o);
      }
    }
  };

  dash.onData(() => {
    applyMeta();
    const p = P();
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === p.mode)));
    document.querySelectorAll('[data-sort]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sort === p.sort)));
    for (const k of ['view', 'part', 'color']) document.querySelectorAll('[data-' + k + ']').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[k] === p[k])));
    if (pending) for (const k in pending) document.querySelectorAll('[data-' + k + ']').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[k] === pending[k])));
    document.querySelectorAll('.bg-only-qbs').forEach((el) => { el.hidden = p.view === 'teams'; });
    document.querySelectorAll('.bg-only-teams').forEach((el) => { el.hidden = p.view !== 'teams'; });
    for (const [id, v] of [['money', p.money], ['perf', p.perf], ['from', p.from], ['to', p.to], ['minatt', p.minatt], ['csort', p.csort], ['posort', p.posort], ['minstart', p.minstart], ['sb', p.sb]]) {
      document.querySelectorAll('#' + id).forEach((el) => { if (document.activeElement !== el) el.value = String(v); });
    }
    document.querySelectorAll('#qb').forEach((el) => { el.hidden = !p.qb; });
  });
})();
