# Refactor plan: GitHub Pages site, then more positions

Goal: publish the dashboard at **https://teinsidler.github.io/nfl-bag-getters/** as a
standalone site, keep the data fresh with little effort, and leave room to add positions
beyond quarterbacks.

This plan merges three planning passes (site architecture, build and deploy, multi-position
data model). Line numbers refer to `dashboard/index.html` as of the initial commit.

## Where things stand

- `dashboard/index.html` (~1,780 lines) was written for the claude.ai dashboard framework.
  It has CSS (lines 2–340), markup (341–699) and four script blocks sharing `window.BG`:
  core and the `leaders`/`league` calcs (700–905), league view (907–1203), QB detail
  (1205–1383) and teams with the Sankey (1385–1781).
- It calls a small framework API: `dash.calc`, `dash.draw` (~60 calls), `dash.data`,
  `dash.params`/`setParams`, `dash.onData`. `dashboard/harness/build.py` holds a stand-in
  for that API, and `dashboard/export_standalone.py` uses it to make a one-file offline copy.
- Data is `data/dashboard/*.json`: ~4.3 MB raw, ~430 KB gzipped (GitHub Pages gzips).
- Hardcoded values that will go stale: `to: 2025` (lines ~702, 766, 1411, 1445 and the
  shim), year `<option>` lists ending at 2026, and the cap `301.2e6` (726, 768, 1412, 1446).
  `cap_factors.json` is built but never loaded.
- "Current season" is computed three different ways across the Python scripts.

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Front-end tooling | Plain ES modules, vendored d3 7.8.5, **no build step** | One JS dependency and ~1,100 lines of JS; nothing to maintain. Revisit (Vite) only if npm deps or TypeScript arrive. |
| Framework API | Keep `dash.*`, promote the shim to a real runtime | All ~60 draw functions keep working unchanged. |
| Deploy | GitHub Actions: `upload-pages-artifact` + `deploy-pages` | No built files committed, no `gh-pages` branch. |
| URL state | Query string (`?qb=…&money=cap&from=2010`) | Pages 404s unknown paths, so no path routing. |
| Data refresh | Hybrid: full refresh stays local; weekly in-season CI job refreshes only active players and the current season | Full OTC scrape is ~8 min and pbp is ~0.5 GB; incremental is cheap and polite. |
| New positions | Per-position data folders and a position registry; QB output stays identical | Keeps payloads small and QB behavior locked. |

## Phase 1 — Get the site live (parity with the claude.ai dashboard)

**1.1 Static shell.** Create `site/`:

```
site/index.html            header, view nav, controls, <main> (markup from index.html)
site/css/tokens.css        real values for the ~30 framework tokens, light + dark + [data-theme]
site/css/glass.css         index.html lines 2–340, moved verbatim
site/js/runtime.js         dash.calc/draw/data/params/setParams/onData (from harness/build.py)
site/js/views/core.js, league.js, qb-detail.js, teams.js   the four script blocks
site/vendor/d3.v7.8.5.min.js   (with its licence)
```

All paths relative (the site lives under `/nfl-bag-getters/`). Data is fetched from
`data/*.json`, copied in at deploy time.
*Done when* serving `_site/` under a `/nfl-bag-getters/` subpath renders both views with
`window.__errors` empty and no requests outside the origin, and the default-view tiles and
tables match `dashboard/qb_bag_getters.html`.

**1.2 Smoke test.** `tests/test_site_smoke.py` (Playwright, Chromium): load the page, assert no
page errors and an empty `window.__errors` (the runtime swallows draw errors), leaderboard
has rows, switch to Teams and check Sankey nodes, open one QB.
*Done when* it passes locally and fails if a JSON file is deleted.

**1.3 Deploy workflow.** `.github/workflows/deploy.yml`: on push to `main` touching
`site/**` or `data/dashboard/**`, plus manual dispatch. Build job copies `site/` and
`data/dashboard/` into `_site/`, runs the smoke test, uploads the Pages artifact; deploy job
uses `environment: github-pages`, `pages: write`, `id-token: write`, `concurrency: pages`.
Owner step: repo Settings → Pages → Source: **GitHub Actions**.
*Done when* the live URL passes the smoke test.

**1.4 Stop hardcoding seasons and cap.** `build_dashboard_data.py` writes
`data/dashboard/meta.json` (`current_season`, `cap`); the page builds year options and
defaults from it and loads cap factors instead of `301.2e6`.
*Done when* bumping the season in the data changes the page with no front-end edit.

**1.5 Retire the claude.ai paths.** Rewrite `export_standalone.py` to inline `site/` for the
offline copy; delete `dashboard/harness/`; update the README. Decide whether to keep
publishing to the claude.ai artifact at all.

## Phase 2 — Make it a good website

**2.1 State in the URL.** `site/js/state.js`: one param schema (defaults, enums, ranges)
that `SEL` (line ~702) and the four calcs read instead of their own defaults. Validate every
value (draws index `MONEY[p.money]` directly, so a bad value throws). `pushState` for `view`,
`qb`, `team`; `replaceState` for filters; `popstate` restores. Deep links use a short QB slug
(`a-j-mccarron-3103`) mapped from the OTC URL; accept the old full-URL form too.
*Done when* `?qb=…&money=cap&from=2010` opens that QB, Back returns to the board, and
`?money=junk` falls back to the default without errors.

**2.2 Theme toggle.** The CSS already honors `:root[data-theme]`. Add an auto/light/dark
toggle saved in localStorage.
*Done when* both themes pass 4.5:1 contrast for muted text on glass and charts recolor.

**2.3 Selective redraw.** Track which params and datasets each calc and draw reads (via a
Proxy behind `P()`), and on change re-run only those. Debounce resize with ResizeObserver.
Keep a `?debug=full` flag that forces full reruns to compare against.
*Done when* changing the sort re-runs only the leaderboard draws.

**2.4 Data loading.** Keep whole files (430 KB gzipped is fine). Load `contracts.json`
lazily when its section scrolls into view; trim unused `seasons` keys.
*Done when* first render happens before `contracts` arrives.

**2.5 Accessibility and mobile.** Narrow the `aria-live` region on `#qb` to the QB name;
make leaderboard names real `<a href="?qb=…">` links; add text summaries or tables beside the
scatter and Sankey; collapse controls into a `<details>` at phone width.
*Done when* axe reports no criticals, the page works by keyboard, and nothing overflows at
375px except the Sankey's own scroller.

## Phase 3 — Pipeline hardening and automatic refresh

**3.1 One entry point.** `pipeline.py` with stages `fetch | transform | validate | site | all`
and `--position qb`, `--offline`, `--refresh-active`; `bag/config.py` with a single
`current_season()` and a `POSITIONS` registry (OTC slug, nflverse positions, output dirs). A
thin `Makefile` wraps it. Old script names stay as wrappers for a while.
*Done when* `python pipeline.py transform --position qb --offline` reproduces today's JSON
**rows** (the `meta` block embeds script source, so compare rows only).

**3.2 Validation gate.** `bag/validate.py` + `tests/test_validate.py`: schema and columns per
file, row counts not more than ~5% below the last build, league wins == losses per year
(and playoffs), every season 1999–current present, no duplicate keys, cash-reconciliation
rate above a threshold, no `UNMATCHED` manual overrides.
*Done when* it passes on current data and fails on a deliberately broken fixture.

**3.3 Incremental fetching.** pbp: reuse committed past seasons, download only the current
one. OTC profiles: `--refresh-active` (players with a current contract or a recent season,
~100), jitter and backoff on 429/503, stop after N failures.
*Done when* a warm run touches ~100 OTC pages and one pbp file and leaves past seasons
byte-identical.

**3.4 Python and pandas upgrade.** Python 3.12, `pyproject.toml` with `pandas>=2.2,<3`, a
lock file, dev extras for pytest and Playwright.
*Done when* the offline transform's rows match between the old and new environments
(floats within tolerance).

**3.5 Scheduled refresh.** `.github/workflows/refresh.yml`: Tuesdays, September to
mid-February, plus manual. Restore caches (but work cold), run
`fetch --refresh-active → transform → validate`; commit if changed and call `deploy.yml`
(a `GITHUB_TOKEN` push doesn't trigger it on its own). On failure commit nothing and let
the job fail so GitHub notifies. Add `ci.yml` for pytest and an offline transform on PRs.
*Done when* a manual run either makes no change or commits and redeploys cleanly.

## Phase 4 — More positions

**4.1 Registry, no behavior change.** Add `--position` to each script (default `qb`) and
move QB constants into the position registry. In the front end, `site/js/positions/qb.js`
exports the PERF measures, aggregate fields, passer rating, QB-only filters
(`minatt`, `minstart`, `sb`) and wording; the `leaders`/`league` calcs read from it. Add a
`pos` URL param and a position nav above the view nav.
*Done when* QB rows and leaderboard output are unchanged and a stub second position renders
the shell with QB-only filters hidden.

**4.2 Snap-count roles.** `fetch_snap_counts.py` (nflverse snap counts, 2012+, PFR ids
crosswalked to gsis). Non-QB "start" = top-N snap share in the position group; season role
starter / rotational / backup / inactive. Before 2012 the role is `unknown` (never a guess
presented as fact). QB roles stay starts-based.
*Done when* ≥95% of 2012+ team-seasons have the expected starters per group and QB roles
are unchanged.

**4.3 Positions in order.** Data goes in `data/dashboard/<pos>/`, loaded only when that
position is picked.

| Order | Group | Measures | Quality |
| --- | --- | --- | --- |
| 1 | RB | scrimmage yards, TDs, rush+rec EPA, first downs, touches, fumbles lost | good, 1999+ |
| 2 | WR / TE | receiving yards, TDs, EPA, receptions, targets, first downs | good, 1999+ |
| 3 | K / P | FGs made, 50+ yard FGs, game-winning FGs, misses; net punt yards, inside-20 | good, 1999+ |
| 4 | EDGE / IDL | sacks, TFL, QB hits (thin before ~2009), forced fumbles | fair |
| 5 | LB, CB / S | tackles, TFL, INTs, passes defended | weak; label as volume stats |
| 6 | OL | snaps, starts, penalties only | proxy only; say so in the UI |

Wins and WPA stay QB-only. Each new group: cash reconciles with OTC career earnings for
≥95% of players, plus spot checks (e.g. McCaffrey, Kelce; season sack leaders).

Risks: players change OTC position lists over a career (dedupe by `player_url`); scraping
grows from ~450 to several thousand profiles (hours at a polite rate, more manual overrides);
defensive volume stats can mislead "bag getter" rankings.

## Decisions for the owner

1. **Over The Cap data in public.** The repo already contains OTC-derived CSVs and JSON,
   and the site will republish them. A weekly scraper from GitHub's servers is also a
   bigger footprint than occasional local runs. OTC's terms and `robots.txt` haven't been
   reviewed. Options: ask OTC for permission, publish only derived aggregates, keep raw OTC
   CSVs out of the repo, and/or keep scraping local only. Settle this before Phase 3.5.
2. **Scraper User-Agent.** The scrapers currently present as a desktop browser. Replace it
   with an honest one naming the project and repo URL, or accept it knowingly.
3. **The claude.ai artifact.** Keep updating it, freeze it, or point it at the Pages site
   once Phase 1 is live.
4. **nflverse licences.** Confirm the README credits meet each dataset's attribution terms.

## Other risks

- Scheduled workflows on public repos are disabled after 60 days without activity (likely
  in the offseason); re-enable each September or add a keepalive.
- Actions caches are evicted after 7 days unused; every job must work from a cold cache.
- OTC page changes can break parsing quietly; the validation gate and the local refresh
  fallback (`make refresh && git push`) cover this.
- Vendored scripts have no cache-busting; add `?v=<commit>` to script tags at deploy.
- The data JSON lives in git, so the repo grows with every refresh (fine for years at
  current sizes).
