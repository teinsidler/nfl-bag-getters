// Tiny runtime for the dashboard's views: the same dash.* API the page was written against
// (calc, draw, data, params, setParams, onData), backed by static JSON in data/.
(function () {
  const DATASETS = ['meta', 'seasons', 'dead_money', 'contracts', 'players', 'team_seasons'];
  const DEFAULTS = { mode: 'all', money: 'cash', perf: 'total_tds', from: null, to: null, minatt: 500, sort: 'most', qb: '',
    csort: 'inflated_apy', view: 'qbs', part: 'reg', team: '', color: 'role', posort: 'po_wins', minstart: 0, sb: 'any' };

  const params = Object.assign({}, DEFAULTS);
  const data = {}, calcs = {}, cache = {}, draws = [], onDataFns = [], errors = [];
  window.__errors = errors; // read by the smoke test: draw errors are caught, not thrown

  const computeCalc = (id) => {
    const c = calcs[id];
    const inputs = c.inputs.map((i) => dash.data(i).data);
    if (inputs.some((x) => x == null)) return null;
    return c.fn(...inputs);
  };

  window.dash = {
    params: () => Object.assign({}, params),
    setParams(o) {
      const changed = Object.keys(o).filter((k) => String(params[k]) !== String(o[k]));
      Object.assign(params, o);
      if (!changed.length) return;
      invalidate(changed);
      if (data.seasons) run(); // synchronous, as the views expect (they scroll and focus right after)
    },
    // o.params (optional) lists the params a calc reads; it is then kept when only other params change
    calc(id, o) { calcs[id] = o; },
    data(id) {
      if (calcs[id]) {
        if (!(id in cache)) {
          try { cache[id] = computeCalc(id); } catch (e) { errors.push('calc ' + id + ': ' + e.stack); console.error('calc ' + id, e); cache[id] = null; }
        }
        return { status: cache[id] ? 'ok' : 'loading', data: cache[id] };
      }
      return data[id] ? { status: 'ok', data: data[id] } : { status: 'loading', data: null };
    },
    draw(name, f) { draws.push([name, f]); },
    onData(f) { onDataFns.push(f); }
  };

  // drop cached calcs that read a changed param, then everything computed from those
  function invalidate(changed) {
    const stale = new Set(Object.keys(calcs).filter((id) => !calcs[id].params || calcs[id].params.some((k) => changed.includes(k))));
    let grew = true;
    while (grew) {
      grew = false;
      for (const id in calcs) if (!stale.has(id) && calcs[id].inputs.some((i) => stale.has(i))) { stale.add(id); grew = true; }
    }
    for (const id of stale) delete cache[id];
  }

  function run() {
    for (const f of onDataFns) { try { f(); } catch (e) { errors.push('onData: ' + e.stack); } }
    for (const [name, f] of draws) {
      document.querySelectorAll('[data-draw="' + name + '"]').forEach((el) => {
        if (el.closest('[hidden]')) return; // drawn when its view is shown
        try {
          if (typeof f === 'function') f(el);
          else {
            if (!el.__made) { el.replaceChildren(); el.__made = f.mount(el); }
            f.update(el, el.__made);
          }
        } catch (e) { errors.push(name + ': ' + e.stack); console.error('draw ' + name, e); }
      });
    }
  }

  let queued = false;
  function schedule() {
    if (queued || !data.seasons) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; run(); });
  }

  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => { if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; schedule(); } });

  async function load() {
    try {
      await Promise.all(DATASETS.map(async (n) => {
        if (window.DASH_INLINE) { data[n] = window.DASH_INLINE[n]; return; } // offline single-file copy
        const r = await fetch('data/' + n + '.json');
        if (!r.ok) throw new Error(n + '.json: HTTP ' + r.status);
        data[n] = (await r.json()).rows;
      }));
    } catch (e) {
      errors.push('load: ' + e.message);
      document.documentElement.classList.remove('is-loading');
      const bar = document.getElementById('load-error');
      if (bar) { bar.hidden = false; bar.textContent = 'The data didn’t load (' + e.message + '). Try reloading the page.'; }
      return;
    }
    const meta = data.meta[0] || {};
    if (params.from == null) params.from = meta.first_stats_season;
    if (params.to == null) params.to = meta.last_complete_season;
    for (const k in cache) delete cache[k]; // drop anything computed before the data arrived
    document.documentElement.classList.remove('is-loading');
    run();
  }

  document.addEventListener('DOMContentLoaded', load);
})();
