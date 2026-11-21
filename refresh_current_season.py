"""Refresh everything that changes during the season, then rebuild the site data.

    python refresh_current_season.py          # then commit data/ and push to publish

Re-downloads this season's games, season stats, play-by-play, weekly game logs, rosters and
trades from nflverse, and rebuilds data/dashboard/*.json (including meta.json's "data through"
and "refreshed" dates). Over The Cap contract pages are NOT re-scraped here (see
fetch_qb_profiles.py --refresh); their pay data changes less often.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
STEPS = [
    ["fetch_qb_wins.py", "--refresh"],   # games: results, starters, lines
    ["fetch_qb_stats.py"],               # season stats (current season always re-downloaded)
    ["fetch_qb_pbp_stats.py"],           # WPA, turnovers, clutch drives (current season re-downloaded)
    ["fetch_weekly.py"],                 # game logs, current teams, trades
    ["build_dashboard_data.py"],         # site data
    ["build_site.py"],                   # _site/ for a local look
]

for step in STEPS:
    print(f"\n=== {' '.join(step)}", flush=True)
    subprocess.run([sys.executable, str(ROOT / step[0]), *step[1:]], check=True, cwd=ROOT)
print("\nDone. Review `git diff --stat data/`, then commit and push to publish.")
