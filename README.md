# NFL Bag Getters

How much do NFL teams pay for production? This project lines up what players were paid
(from [Over The Cap](https://overthecap.com)) with what they did on the field (from
[nflverse](https://github.com/nflverse)) and ranks who got the biggest bag per touchdown,
per win, per start and more.

**The initial focus is quarterbacks.** Every script, dataset and view so far covers QBs.
The plan is to keep building out to more positions (running backs, receivers, edge
rushers and so on) on the same pay-versus-production model.

## The dashboard

**Live site: https://teinsidler.github.io/nfl-bag-getters/**

The dashboard has two views:

- **Quarterbacks:** pay vs production leaderboards (TDs, yards, EPA, starts, wins, WPA,
  turnovers and more), playoff records, dead cap, contract tables and a page per QB.
- **Teams:** a Sankey of where each franchise's quarterback money went for a season or a
  range of seasons, colored by role (starter, spot starter, backup, dead cap), deal type
  or how the QB arrived (drafted, signed, traded for).

It is a static site: plain HTML, CSS and JavaScript in `site/` (no build tools), with d3
vendored in `site/vendor/`. `site/js/runtime.js` loads `data/*.json` and redraws the views in
`site/js/views/` when a control changes. Season ranges and the current salary cap come from
`data/dashboard/meta.json`, so a new season needs no front-end edits.
Ongoing work is tracked in [`planning/REFACTOR_PLAN.md`](planning/REFACTOR_PLAN.md).

### Run it locally

```bash
python3 build_site.py                  # assembles _site/ from site/ + data/dashboard/
python3 -m http.server -d _site 8000   # then open http://localhost:8000
```

### Test

```bash
pip install -r requirements-dev.txt && python -m playwright install chromium
python3 build_site.py && python -m pytest tests/
```

The smoke test serves `_site/` under `/nfl-bag-getters/` (as GitHub Pages does) and fails on
any page error, failed request or error caught while drawing.

### Publish

Every push to `main` that touches `site/`, `data/dashboard/` or the build runs
`.github/workflows/deploy.yml`: build, smoke test, deploy to GitHub Pages.

### Offline copy

```bash
python3 export_standalone.py   # writes qb_bag_getters.html, ~4.6 MB, opens without a server
```

## Data pipeline

Requires Python 3.9+ (`pip install -r requirements.txt`). Run in this order:

| Step | Script | Writes |
| --- | --- | --- |
| 1 | `fetch_qb_contracts.py` | `data/qb_contracts.csv`, `data/qb_players.csv` (OTC QB contract history) |
| 2 | `fetch_qb_stats.py` | `data/qb_season_stats.csv` (nflverse season stats, 1999+) |
| 3 | `add_rookie_contracts.py` | adds rookie year and nflverse ids to the step 1 files |
| 4 | `fetch_qb_profiles.py` | `data/otc_profile_*.csv` (each QB's OTC profile; raw HTML cached) |
| 5 | `fix_profile_quirks.py` | `data/otc_profile_*_clean.csv` (applies `data/manual_overrides.csv`) |
| 6 | `fetch_qb_wins.py` | `data/qb_game_starts.csv`, `data/qb_season_wins.csv` (records, Vegas lines, playoffs) |
| 7 | `fetch_qb_pbp_stats.py` | `data/qb_season_pbp.csv` (WPA, turnovers, comebacks; ~0.5 GB download) |
| 8 | `fetch_weekly.py` | `data/qb_week_games.csv`, `data/qb_current_team.csv`, `data/trades.csv` (this season's game logs, current teams, trades) |
| 9 | `build_dashboard_data.py` | `data/dashboard/*.json` (what the site reads, incl. `meta.json` and `game_log.json`) |

**During the season,** one command refreshes everything that changes week to week (games,
stats, play-by-play, game logs, rosters, trades) and rebuilds the site data:

```bash
python3 refresh_current_season.py   # then commit data/ and push; the site redeploys itself
```

It does not re-scrape Over The Cap; run `fetch_qb_profiles.py --refresh` and step 5 for new
contracts. The site header shows the last game in the data and the refresh date.

Downloads are cached under `data/nflverse_cache/` and `data/otc_profiles_html/`, which
are not committed.

Each March, update `LEAGUE_CAP` in `build_dashboard_data.py` to the new league cap.

## Coverage and caveats

- Stats start in 1999 (nflverse play-by-play). Paid seasons before that have no production.
- Trades and pickups: when a quarterback changes teams mid-season, Over The Cap files the
  season under his last team. The Teams view credits each team with the starts he made there
  and the money it paid him before the move (OTC lists that as dead money). Trades come from
  nflverse's trades list, which lags in-season, backed up by OTC's "Traded" contract status.
- A game's "starter" is the QB who took most of the snaps, so rest-game records can differ
  slightly from Pro-Football-Reference.
- Contract figures are Over The Cap's. Cash paid includes signing bonuses in the year paid;
  cap numbers prorate them.

`research/` holds one-off analyses, such as how fourth-quarter comebacks and
game-winning drives are detected.

## Credits

- Contract data: [Over The Cap](https://overthecap.com)
- Stats, play-by-play and game data: [nflverse](https://github.com/nflverse)
