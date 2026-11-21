"""Current-season game logs, current teams and trades from nflverse.

Downloads (always fresh, since they change during the season):
  - weekly player stats for the current season (one row per player per game)
  - weekly rosters for the current season (each player's team, week by week)
  - nflverse's trades list (github.com/nflverse/nfldata, trades.csv; updated by hand, so the
    newest in-season trades can lag; Over The Cap's "Traded" contract status fills that gap)

Writes:
  data/qb_week_games.csv    one row per game for every quarterback on the contract list:
                            week, team, opponent, passing/rushing line, EPA
  data/qb_current_team.csv  each quarterback's team in the latest week of the current season
  data/qb_pfr_ids.csv       gsis id -> Pro-Football-Reference id for this season's quarterbacks
  data/trades.csv           every player in a trade: season, date, team that gave him up, team that got him

    python fetch_weekly.py
"""
from datetime import date
from io import BytesIO
from pathlib import Path

import pandas as pd
import requests

DATA = Path(__file__).parent / "data"
REL = "https://github.com/nflverse/nflverse-data/releases/download/"
STATS_URL = REL + "stats_player/stats_player_week_{}.parquet"
ROSTER_URL = REL + "weekly_rosters/roster_weekly_{}.parquet"
TRADES_URL = "https://github.com/nflverse/nfldata/raw/master/data/trades.csv"


def current_season() -> int:
    today = date.today()
    return today.year if today.month >= 9 else today.year - 1


def get(url: str) -> bytes:
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    return r.content


def fetch_parquet(url: str):
    """None when the file isn't published yet (early September, before week 1)."""
    try:
        return pd.read_parquet(BytesIO(get(url)))
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            print(f"not published yet: {url}")
            return None
        raise


GONE = {"RET", "CUT", "TRD", "TRC", "TRT", "EXE"}  # retired, cut, traded away, exempt: not on the team now


def main() -> None:
    season = current_season()
    ids = set(pd.read_csv(DATA / "qb_players.csv").gsis_id.dropna())

    # ---- game logs -------------------------------------------------------------------
    w = fetch_parquet(STATS_URL.format(season))
    if w is None:
        w = pd.DataFrame(columns=["player_id", "attempts", "carries", "passing_epa", "rushing_epa", "player_display_name", "season",
                                  "week", "season_type", "game_id", "team", "opponent_team", "completions", "passing_yards",
                                  "passing_tds", "passing_interceptions", "sacks_suffered", "rushing_yards", "rushing_tds"])
    w = w[w.player_id.isin(ids) & (w.attempts.fillna(0) + w.carries.fillna(0) > 0)].copy()
    w["epa"] = w.passing_epa.fillna(0) + w.rushing_epa.fillna(0)
    cols = {"player_id": "player_id", "player_display_name": "player_name", "season": "season", "week": "week",
            "season_type": "season_type", "game_id": "game_id", "team": "team", "opponent_team": "opponent",
            "completions": "completions", "attempts": "attempts", "passing_yards": "passing_yards",
            "passing_tds": "passing_tds", "passing_interceptions": "interceptions", "sacks_suffered": "sacks",
            "carries": "carries", "rushing_yards": "rushing_yards", "rushing_tds": "rushing_tds", "epa": "epa"}
    games = w[list(cols)].rename(columns=cols).sort_values(["player_id", "season_type", "week"])
    games["epa"] = games.epa.round(2)
    games.to_csv(DATA / "qb_week_games.csv", index=False)

    # ---- current team: the latest week each quarterback is on a roster ---------------------
    r = fetch_parquet(ROSTER_URL.format(season))
    if r is None:
        r = pd.DataFrame(columns=["gsis_id", "pfr_id", "season", "week", "team", "status"])
    # each team's own latest roster week (teams knocked out of the playoffs stop at their last game)
    team_last = r.groupby("team").week.transform("max") if len(r) else r.week
    r = r[r.gsis_id.isin(ids)].sort_values(["gsis_id", "week"])
    latest = r[(r.week == team_last.loc[r.index]) & ~r.status.isin(GONE)] if len(r) else r
    # a player cut by one team and still on another keeps the team he was on most recently
    cur = latest.groupby("gsis_id").tail(1)[["gsis_id", "pfr_id", "season", "week", "team", "status"]]
    pfr = r.dropna(subset=["pfr_id"]).groupby("gsis_id").pfr_id.last().rename("pfr_any")
    cur = cur.merge(pfr, left_on="gsis_id", right_index=True, how="left")
    cur.to_csv(DATA / "qb_current_team.csv", index=False)
    # gsis -> pfr id for every QB on any roster this season (trades.csv is keyed by pfr id)
    pfr.reset_index().rename(columns={"pfr_any": "pfr_id"}).to_csv(DATA / "qb_pfr_ids.csv", index=False)

    # ---- trades (players only; picks have no pfr_id) -------------------------------------
    t = pd.read_csv(BytesIO(get(TRADES_URL)))
    t = t[t.pfr_id.notna()][["trade_id", "season", "trade_date", "gave", "received", "pfr_id", "pfr_name"]]
    t.to_csv(DATA / "trades.csv", index=False)

    last = games[games.season_type == "REG"].week.max() if len(games) else None
    print(f"{season}: {len(games)} QB game rows through week {last}; "
          f"{len(cur)} QBs on a roster (week {r.week.max()}); {len(t)} traded players on file "
          f"(latest {t.trade_date.max()})")


if __name__ == "__main__":
    main()
