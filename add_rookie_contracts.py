"""Add rookie year and a rookie-contract flag to the QB contract data.

Run after fetch_qb_contracts.py and fetch_qb_stats.py. It reads their CSVs, looks up
each quarterback in the nflverse players table, and rewrites:

  data/qb_players.csv    + gsis_id (= player_id in qb_season_stats.csv), rookie_year,
                           draft_year/round/pick/team, has_stats
  data/qb_contracts.csv  + gsis_id, rookie_year, is_rookie_contract

Matching: by Over The Cap id (in the player URL) first, then by normalized name
among nflverse QBs.
Rookie year: draft year for drafted players. For undrafted players, the earlier of
nflverse rookie_season (first season on an NFL roster) and their first OTC contract,
since undrafted free agents often sign a year before they make a roster. QBs that
aren't in the nflverse players table (mostly fringe undrafted players) fall back to
their first OTC contract year. rookie_year_source says which rule applied.
Rookie contract: a contract signed in the player's rookie year. Players whose earliest
OTC contract comes after their rookie year (mostly pre-2000s players) get no rookie
contract flagged, because OTC doesn't list that deal.
"""
import re
from pathlib import Path

import pandas as pd

DATA = Path(__file__).parent / "data"
PLAYERS_URL = "https://github.com/nflverse/nflverse-data/releases/download/players/players.parquet"
ADDED_PLAYER_COLS = ["gsis_id", "rookie_year", "draft_year", "draft_round", "draft_pick",
                     "draft_team", "has_stats", "match_method", "rookie_year_source"]
ADDED_CONTRACT_COLS = ["gsis_id", "rookie_year", "is_rookie_contract"]


def norm_name(name: str) -> str:
    name = re.sub(r"[.'’,-]", "", str(name).lower())
    name = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", name)
    return " ".join(name.split())


def main() -> None:
    contracts = pd.read_csv(DATA / "qb_contracts.csv")
    contracts = contracts.drop(columns=[c for c in ADDED_CONTRACT_COLS if c in contracts])
    players = pd.read_csv(DATA / "qb_players.csv")
    players = players.drop(columns=[c for c in ADDED_PLAYER_COLS if c in players])
    stats_ids = set(pd.read_csv(DATA / "qb_season_stats.csv", usecols=["player_id"]).player_id)

    nfl = pd.read_parquet(PLAYERS_URL)[
        ["gsis_id", "display_name", "otc_id", "position", "rookie_season",
         "draft_year", "draft_round", "draft_pick", "draft_team"]
    ]
    nfl["rookie_year"] = nfl["draft_year"].fillna(nfl["rookie_season"])  # refined per player below

    players["otc_id"] = players["player_url"].str.extract(r"/(\d+)/?$")[0]
    first_signed = contracts.groupby("player_url")["year_signed"].min()
    players["first_signed"] = players["player_url"].map(first_signed)

    # 1) match on Over The Cap id
    by_otc = nfl.dropna(subset=["otc_id"]).assign(otc_id=lambda d: d.otc_id.astype(str))
    by_otc = by_otc.drop_duplicates("otc_id").set_index("otc_id")["gsis_id"]
    players["gsis_id"] = players["otc_id"].map(by_otc)
    players["match_method"] = players["gsis_id"].notna().map({True: "otc_id", False: None})

    # 2) fall back to name among nflverse QBs; if a name is shared, take the QB whose
    #    rookie year is the latest one not after this player's first OTC contract
    qbs = nfl[nfl["position"] == "QB"].assign(key=lambda d: d.display_name.map(norm_name))
    for i, row in players[players["gsis_id"].isna()].iterrows():
        cands = qbs[qbs["key"] == norm_name(row["player"])]
        cands = cands[~cands["gsis_id"].isin(players["gsis_id"].dropna())]
        if len(cands) > 1:
            ok = cands[cands["rookie_year"] <= row["first_signed"]]
            cands = ok.sort_values("rookie_year").tail(1) if len(ok) else cands.iloc[0:0]
        if len(cands) == 1:
            players.at[i, "gsis_id"] = cands["gsis_id"].iloc[0]
            players.at[i, "match_method"] = "name"

    info = nfl.set_index("gsis_id")[["rookie_year", "draft_year", "draft_round", "draft_pick", "draft_team"]]
    players = players.join(info, on="gsis_id")
    players["has_stats"] = players["gsis_id"].isin(stats_ids)

    drafted = players["draft_year"].notna()
    undrafted = players["gsis_id"].notna() & ~drafted
    unmatched = players["gsis_id"].isna()
    players.loc[undrafted, "rookie_year"] = players.loc[undrafted, ["rookie_year", "first_signed"]].min(axis=1)
    players.loc[unmatched, "rookie_year"] = players.loc[unmatched, "first_signed"]
    players["rookie_year_source"] = "draft_year"
    players.loc[undrafted, "rookie_year_source"] = "undrafted_first_season_or_contract"
    players.loc[unmatched, "rookie_year_source"] = "first_otc_contract"
    for col in ["rookie_year", "draft_year", "draft_round", "draft_pick"]:
        players[col] = players[col].astype("Int64")

    contracts = contracts.merge(players[["player_url", "gsis_id", "rookie_year"]], on="player_url", how="left")
    contracts["is_rookie_contract"] = contracts["year_signed"] == contracts["rookie_year"]
    contracts["is_rookie_contract"] = contracts["is_rookie_contract"].fillna(False).astype(bool)

    players.drop(columns=["otc_id", "first_signed"]).to_csv(DATA / "qb_players.csv", index=False)
    contracts.to_csv(DATA / "qb_contracts.csv", index=False)

    n = len(players)
    print(f"Matched {players.gsis_id.notna().sum()}/{n} QBs to nflverse "
          f"({(players.match_method == 'otc_id').sum()} by OTC id, {(players.match_method == 'name').sum()} by name)")
    print(f"{players.has_stats.sum()}/{n} QBs have 1999+ stats")
    rookie_players = contracts.loc[contracts.is_rookie_contract, "player_url"].nunique()
    print(f"Flagged {contracts.is_rookie_contract.sum()} rookie contracts across {rookie_players} QBs")
    unmatched = players.loc[players.gsis_id.isna(), "player"].tolist()
    if unmatched:
        print("Unmatched:", ", ".join(unmatched))


if __name__ == "__main__":
    main()
