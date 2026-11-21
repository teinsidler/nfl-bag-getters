"""Season-by-season win/loss record and other win-related stats for every starting QB.

Source: the nflverse games file (one row per game, 1999 on, with each team's starting QB,
the final score and the Vegas line). Cached in data/nflverse_cache/games.csv; pass
--refresh to download again.

Outputs (player_id = nflverse gsis id, same key as qb_season_stats.csv / qb_players.gsis_id):
  data/qb_game_starts.csv   one row per QB start (regular season and playoffs)
  data/qb_season_wins.csv   one row per QB per season:
      starts, wins, losses, ties, win_pct (ties count as half a win)
      points_for/against per start, point_diff
      one_score_wins/losses (final margin of 8 or fewer)
      favored_starts, underdog_wins (won when the line had them losing)
      expected_wins: wins a typical QB would expect from the Vegas line, so
      wins_over_expected is the record above or below what the betting market priced in
      ats_wins/losses/pushes (against the spread)
      po_starts, po_wins, po_losses, conf_title_wins, sb_starts, sb_wins (playoffs)
Only completed games count, so the current season is partial.

Known difference from Pro-Football-Reference: nflverse names the QB who took most of the
team's snaps, not the one who took the first snap. When a starter is pulled early (often
week 17/18 rest games), the backup gets the start here. Brady is 251-79 here vs 251-82 on
PFR (2005 wk 17 Cassel, 2014 wk 17 Garoppolo, 2022 wk 18 Gabbert); Manning and Rivers
differ by a few games the same way.
"""
import math
import sys
from pathlib import Path

import pandas as pd

DATA = Path(__file__).parent / "data"
CACHE = DATA / "nflverse_cache" / "games.csv"
GAMES_URL = "https://github.com/nflverse/nfldata/raw/master/data/games.csv"
SPREAD_SD = 13.45  # std dev of NFL final margin around the closing line (Stern 1991 ~13.9; modern ~13.5)
ONE_SCORE = 8


def load_games(refresh: bool) -> pd.DataFrame:
    if refresh or not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        pd.read_csv(GAMES_URL).to_csv(CACHE, index=False)
    return pd.read_csv(CACHE)


def win_prob(spread: float) -> float:
    """Chance a team favored by `spread` points wins (normal approximation)."""
    if pd.isna(spread):
        return float("nan")
    return 0.5 * (1 + math.erf(spread / (SPREAD_SD * math.sqrt(2))))


def game_starts(games: pd.DataFrame) -> pd.DataFrame:
    g = games[games["result"].notna()]  # completed games only
    # nflverse: result = home - away score; spread_line > 0 means the home team was favored
    sides = []
    for side, opp, sign in (("home", "away", 1), ("away", "home", -1)):
        sides.append(pd.DataFrame({
            "game_id": g["game_id"], "season": g["season"], "week": g["week"],
            "game_type": g["game_type"], "gameday": g["gameday"],
            "player_id": g[f"{side}_qb_id"], "player_name": g[f"{side}_qb_name"],
            "team": g[f"{side}_team"], "opponent": g[f"{opp}_team"], "home": side == "home",
            "points_for": g[f"{side}_score"], "points_against": g[f"{opp}_score"],
            "spread": sign * g["spread_line"],  # points this QB's team was favored by
            "moneyline": g[f"{side}_moneyline"],
            "div_game": g["div_game"].astype(bool), "overtime": g["overtime"].astype(bool),
        }))
    s = pd.concat(sides, ignore_index=True).dropna(subset=["player_id"])
    margin = s["points_for"] - s["points_against"]
    s["margin"] = margin
    s["outcome"] = pd.Series("T", index=s.index).mask(margin > 0, "W").mask(margin < 0, "L")
    s["win_value"] = (margin > 0) + 0.5 * (margin == 0)
    s["expected_win"] = s["spread"].map(win_prob)
    ats = margin - s["spread"]  # beat the line if margin > points favored by; NaN when no line
    s["ats"] = pd.Series(pd.NA, index=s.index, dtype="object")
    s.loc[ats > 0, "ats"] = "W"
    s.loc[ats < 0, "ats"] = "L"
    s.loc[ats == 0, "ats"] = "P"
    s["playoff"] = s["game_type"] != "REG"
    return s.sort_values(["season", "week", "game_id", "home"]).reset_index(drop=True)


def season_table(s: pd.DataFrame) -> pd.DataFrame:
    reg, po = s[~s.playoff], s[s.playoff]
    key = ["player_id", "season"]
    w, l, t = (reg.outcome == "W"), (reg.outcome == "L"), (reg.outcome == "T")
    one = reg.margin.abs() <= ONE_SCORE
    fav = reg.spread > 0
    out = reg.assign(
        wins=w, losses=l, ties=t,
        one_score_wins=w & one, one_score_losses=l & one,
        favored=fav, underdog_starts=reg.spread < 0, underdog_wins=w & (reg.spread < 0),
        favored_losses=l & fav,
        ats_wins=reg.ats == "W", ats_losses=reg.ats == "L", ats_pushes=reg.ats == "P",
        div_wins=w & reg.div_game, div_starts=reg.div_game, ot_starts=reg.overtime, ot_wins=w & reg.overtime,
    ).groupby(key).agg(
        player_name=("player_name", "last"),
        team=("team", "last"),
        teams=("team", lambda x: "/".join(dict.fromkeys(x))),
        starts=("game_id", "size"),
        wins=("wins", "sum"), losses=("losses", "sum"), ties=("ties", "sum"),
        win_value=("win_value", "sum"),
        points_for=("points_for", "sum"), points_against=("points_against", "sum"),
        one_score_wins=("one_score_wins", "sum"), one_score_losses=("one_score_losses", "sum"),
        favored_starts=("favored", "sum"), underdog_starts=("underdog_starts", "sum"),
        underdog_wins=("underdog_wins", "sum"), favored_losses=("favored_losses", "sum"),
        expected_wins=("expected_win", "sum"),
        ats_wins=("ats_wins", "sum"), ats_losses=("ats_losses", "sum"), ats_pushes=("ats_pushes", "sum"),
        div_starts=("div_starts", "sum"), div_wins=("div_wins", "sum"),
        ot_starts=("ot_starts", "sum"), ot_wins=("ot_wins", "sum"),
        home_starts=("home", "sum"),
    )
    out["win_pct"] = (out.win_value / out.starts).round(3)
    out["wins_over_expected"] = (out.win_value - out.expected_wins).round(2)
    out["expected_wins"] = out.expected_wins.round(2)
    out["point_diff"] = out.points_for - out.points_against
    out["points_for_per_start"] = (out.points_for / out.starts).round(1)
    out["points_against_per_start"] = (out.points_against / out.starts).round(1)

    pw, pl = po.outcome == "W", po.outcome == "L"
    pos = po.assign(
        po_wins=pw, po_losses=pl,
        conf_title_wins=pw & (po.game_type == "CON"),
        sb_starts=po.game_type == "SB", sb_wins=pw & (po.game_type == "SB"),
    ).groupby(key).agg(
        po_player_name=("player_name", "last"), po_team=("team", "last"),
        po_starts=("game_id", "size"), po_wins=("po_wins", "sum"), po_losses=("po_losses", "sum"),
        po_points_for=("points_for", "sum"), po_points_against=("points_against", "sum"),
        conf_title_wins=("conf_title_wins", "sum"), sb_starts=("sb_starts", "sum"), sb_wins=("sb_wins", "sum"),
    )
    # a QB can start a playoff game without a regular-season start that year (e.g. a late call-up)
    out = out.join(pos, how="outer")
    out["player_name"] = out.player_name.fillna(out.pop("po_player_name"))
    out["team"] = out.team.fillna(out.pop("po_team"))
    out["teams"] = out.teams.fillna(out.team)
    counts = [c for c in out.columns if c not in
              ("player_name", "team", "teams", "win_pct", "wins_over_expected", "expected_wins",
               "points_for_per_start", "points_against_per_start")]
    out[counts] = out[counts].fillna(0).astype(int)
    out["po_win_pct"] = (out.po_wins / out.po_starts.where(out.po_starts > 0)).round(3)

    cols = ["player_name", "team", "teams", "starts", "wins", "losses", "ties", "win_pct",
            "expected_wins", "wins_over_expected", "favored_starts", "favored_losses",
            "underdog_starts", "underdog_wins", "ats_wins", "ats_losses", "ats_pushes",
            "one_score_wins", "one_score_losses", "div_starts", "div_wins", "ot_starts", "ot_wins",
            "home_starts", "points_for", "points_against", "point_diff",
            "points_for_per_start", "points_against_per_start",
            "po_starts", "po_wins", "po_losses", "po_win_pct", "po_points_for", "po_points_against",
            "conf_title_wins", "sb_starts", "sb_wins"]
    return out[cols].reset_index()


def main(refresh: bool = False) -> None:
    starts = game_starts(load_games(refresh))
    starts.drop(columns=["win_value"]).to_csv(DATA / "qb_game_starts.csv", index=False)
    seasons = season_table(starts)

    players = pd.read_csv(DATA / "qb_players.csv", usecols=["gsis_id", "player_url"])
    seasons["in_contract_list"] = seasons.player_id.isin(players.gsis_id)
    seasons.to_csv(DATA / "qb_season_wins.csv", index=False)

    reg = starts[~starts.playoff]
    print(f"{len(starts)} QB starts ({starts.playoff.sum()} playoff), {starts.season.min()}-{starts.season.max()}")
    print(f"{len(seasons)} QB-seasons, {seasons.player_id.nunique()} QBs "
          f"({seasons[seasons.in_contract_list].player_id.nunique()} on the OTC contract list)")
    # sanity: every completed regular-season game has two starters, and wins == losses league-wide
    print(f"league check: wins {seasons.wins.sum()} = losses {seasons.losses.sum()}, ties {seasons.ties.sum()} (even)")
    print(f"Vegas check: expected wins {seasons.expected_wins.sum():.0f} vs actual "
          f"{(reg.win_value.sum()):.0f} on {reg.spread.notna().sum()} lined starts")
    show = seasons.sort_values(["wins_over_expected"], ascending=False)
    print("\nBest seasons vs Vegas:")
    print(show.head(5)[["player_name", "season", "team", "wins", "losses", "expected_wins", "wins_over_expected"]]
          .to_string(index=False))
    print("\nCareer starting records (top 8 by wins):")
    car = seasons.groupby("player_id").agg(
        name=("player_name", "last"), w=("wins", "sum"), l=("losses", "sum"), t=("ties", "sum"),
        pw=("po_wins", "sum"), pl=("po_losses", "sum"), sb=("sb_wins", "sum"), woe=("wins_over_expected", "sum"))
    print(car.sort_values("w", ascending=False).head(8).round(1).to_string(index=False))


if __name__ == "__main__":
    main(refresh="--refresh" in sys.argv)
