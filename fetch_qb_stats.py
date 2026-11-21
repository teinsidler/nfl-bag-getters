"""Pull season-level regular-season stats for every NFL quarterback and write them to CSV.

Source: nflverse season-level player stats files
(github.com/nflverse/nflverse-data, release "stats_player", stats_player_reg_<year>).

Coverage note: nflverse player stats come from play-by-play data, which starts in
1999. Seasons 1983-1998 aren't available from this source.

Output: data/qb_season_stats.csv (incl. fumbles, fumbles_lost and turnovers = INT + fumbles lost)
"""
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

START_YEAR = 1999  # earliest season nflverse has (requested range started at 1983)
OUT = Path(__file__).parent / "data" / "qb_season_stats.csv"
URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/"
    "stats_player/stats_player_reg_{year}.parquet"
)

# nflverse column -> output column
RENAMES = {
    "player_display_name": "player_name",  # full name ("Patrick Mahomes", not "P.Mahomes")
    "recent_team": "team",
    "passing_interceptions": "interceptions",
    "sacks_suffered": "sacks",
    "sack_yards_lost": "sack_yards",
    "fumbles_total": "fumbles",  # every fumble, incl. fumbled snaps (not just sack/rush/catch)
    "fumbles_lost_total": "fumbles_lost",
}
ID_COLS = ["player_id", "player_name", "position", "team", "season", "season_type", "headshot_url"]
STAT_COLS = [
    "games", "completions", "attempts", "passing_yards", "passing_tds", "interceptions",
    "sacks", "sack_yards", "sack_fumbles", "sack_fumbles_lost",
    "passing_air_yards", "passing_yards_after_catch", "passing_first_downs",
    "passing_epa", "passing_cpoe", "passing_2pt_conversions", "pacr",
    "carries", "rushing_yards", "rushing_tds", "rushing_fumbles", "rushing_fumbles_lost",
    "rushing_first_downs", "rushing_epa", "rushing_2pt_conversions",
    "fumbles", "fumbles_lost",
    "fantasy_points", "fantasy_points_ppr",
]
CACHE = Path(__file__).parent / "data" / "nflverse_cache"


def current_season() -> int:
    today = date.today()
    return today.year if today.month >= 9 else today.year - 1


def add_rate_stats(df: pd.DataFrame) -> pd.DataFrame:
    att = df["attempts"].replace(0, np.nan)
    df["completion_pct"] = (100 * df["completions"] / att).round(1)
    df["yards_per_attempt"] = (df["passing_yards"] / att).round(2)
    df["td_pct"] = (100 * df["passing_tds"] / att).round(1)
    df["int_pct"] = (100 * df["interceptions"] / att).round(1)

    # NFL passer rating: each component clamped to [0, 2.375]
    clamp = lambda s: s.clip(lower=0, upper=2.375)
    a = clamp((df["completions"] / att - 0.3) * 5)
    b = clamp((df["passing_yards"] / att - 3) * 0.25)
    c = clamp(df["passing_tds"] / att * 20)
    d = clamp(2.375 - df["interceptions"] / att * 25)
    df["passer_rating"] = ((a + b + c + d) / 6 * 100).round(1)

    # turnovers: interceptions plus fumbles lost (all kinds)
    df["turnovers"] = df["interceptions"] + df["fumbles_lost"]
    return df


def main() -> None:
    frames = []
    for year in range(START_YEAR, current_season() + 1):
        cached = CACHE / f"stats_player_reg_{year}.parquet"
        try:
            # past seasons don't change, so reuse a cached copy; always refetch the current one
            src = cached if cached.exists() and year < current_season() else URL.format(year=year)
            df = pd.read_parquet(src)
        except Exception as e:
            print(f"{year}: not available ({type(e).__name__}); skipping")
            continue
        df = df.drop(columns=["player_name"]).rename(columns=RENAMES)
        df = df[(df["position"] == "QB") & (df["attempts"].fillna(0) > 0)]
        frames.append(df[ID_COLS + STAT_COLS])
        print(f"{year}: {len(df)} QBs")

    out = add_rate_stats(pd.concat(frames, ignore_index=True))
    assert not out.duplicated(["player_id", "season"]).any(), "duplicate player-seasons"
    out = out.sort_values(["season", "passing_yards"], ascending=[True, False])
    OUT.parent.mkdir(exist_ok=True)
    out.to_csv(OUT, index=False)
    print(f"\nWrote {len(out)} rows ({out.season.min()}-{out.season.max()}, "
          f"{out.player_id.nunique()} QBs) to {OUT}")


if __name__ == "__main__":
    main()
