# NFL Bag Getters

How much do NFL teams pay for production? This project lines up what players were paid
(from [Over The Cap](https://overthecap.com)) with what they did on the field (from
[nflverse](https://github.com/nflverse)) and ranks who got the biggest bag per touchdown,
per win, per start and more.

**The initial focus is quarterbacks.** Every script, dataset and view so far covers QBs.
The plan is to keep building out to more positions (running backs, receivers, edge
rushers and so on) on the same pay-versus-production model.

## The dashboard

The dashboard (`dashboard/index.html`) has two views:

- **Quarterbacks:** pay vs production leaderboards (TDs, yards, EPA, starts, wins, WPA,
  turnovers and more), playoff records, dead cap, contract tables and a page per QB.
- **Teams:** a Sankey of where each franchise's quarterback money went for a season or a
  range of seasons, colored by role (starter, spot starter, backup, dead cap), deal type
  or how the QB arrived (drafted, signed, traded for).

It is being moved to a standalone site on GitHub Pages. See
[`planning/REFACTOR_PLAN.md`](planning/REFACTOR_PLAN.md) for that work.

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
| 8 | `build_dashboard_data.py` | `data/dashboard/*.json` (what the dashboard reads) |

Downloads are cached under `data/nflverse_cache/` and `data/otc_profiles_html/`, which
are not committed.

To view the dashboard locally:

```bash
python3 dashboard/export_standalone.py   # writes dashboard/qb_bag_getters.html
```

Then open that file in a browser.

## Coverage and caveats

- Stats start in 1999 (nflverse play-by-play). Paid seasons before that have no production.
- A game's "starter" is the QB who took most of the snaps, so rest-game records can differ
  slightly from Pro-Football-Reference.
- Contract figures are Over The Cap's. Cash paid includes signing bonuses in the year paid;
  cap numbers prorate them.

`research/` holds one-off analyses, such as how fourth-quarter comebacks and
game-winning drives are detected.

## Credits

- Contract data: [Over The Cap](https://overthecap.com)
- Stats, play-by-play and game data: [nflverse](https://github.com/nflverse)
