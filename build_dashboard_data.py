"""Build the JSON files the QB Bag Getters dashboard reads.

Run last, after fetch_qb_contracts.py, fetch_qb_stats.py, add_rookie_contracts.py,
fetch_qb_profiles.py and fix_profile_quirks.py.

Also reads fetch_qb_wins.py's qb_game_starts.csv and fetch_qb_pbp_stats.py's qb_season_pbp.csv.

Writes data/dashboard/{seasons,dead_money,contracts,players,cap_factors,team_seasons,meta}.json, each
{"rows": [...], "meta": [...]}; meta carries this script's source so readers can check it.

Rules
- A season counts under the latest non-practice-squad contract the QB signed on or before
  that year (same team first, any team otherwise). Drafted/UDFA contracts are "rookie",
  every other type is "veteran", and a season with no contract on record is "unknown".
- Dead money charged in year Y by team T is attributed to the QB's latest contract with T
  signed on or before Y.
- Season cash comes from OTC's season history. Money paid out as dead money is in the
  dead money table, so the dashboard adds the two together.
- Projected seasons (after the current one) and void years are dropped.
- Cap-adjusted dollars use OTC's own inflation factor (current-season cap / that year's
  cap), read off OTC's "inflated" contract values.
- Stats come from nflverse (1999+). A paid season from 1999 on with no stats row is a
  season with zero production.
- Wins, losses and starts are the QB's starts (nflverse: the QB who took most snaps).
  WPA, playoff turnovers and clutch drives come from play-by-play. Regular-season and
  playoff values are kept in separate columns (po_ prefix = playoffs).
- Team role (for the team page): "starter" = most starts for that franchise that season,
  "spot" = some starts, "backup" = played but no starts, "inactive" = no games.
  Dead money rows are money for a QB no longer on that deal.
- How a QB arrived (arrival, per stint with a franchise): "homegrown" = his rookie deal
  (drafted or undrafted) was with this team, "traded" = the contract before the one in force
  at the start of the stint ended "Traded", "signed" = anything else (free agency, waiver claim).
- How a dead charge came about (exit, from the status of the contract it is charged to):
  traded, released (incl. post-June 1 and waiver claims), void (void years accelerating at
  expiry), retired, other (renegotiations, or a charge pointing at another team's contract).
"""
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).parent / "data"
OUT = DATA / "dashboard"
ROOKIE_TYPES = {"Drafted", "UDFA"}
FIRST_STATS_SEASON = 1999
# latest league salary cap known here (year, dollars); update each March when the NFL sets the new cap
LEAGUE_CAP = (2025, 279.2e6)
# franchise names: OTC nicknames and nflverse abbreviations (relocations folded in)
OTC_FRANCHISE = {"Redskins": "Washington", "Commanders": "Washington", "Washington": "Washington", "Oilers": "Titans"}
ABBR = {"ARI": "Cardinals", "ATL": "Falcons", "BAL": "Ravens", "BUF": "Bills", "CAR": "Panthers", "CHI": "Bears",
        "CIN": "Bengals", "CLE": "Browns", "DAL": "Cowboys", "DEN": "Broncos", "DET": "Lions", "GB": "Packers",
        "HOU": "Texans", "IND": "Colts", "JAX": "Jaguars", "KC": "Chiefs", "LA": "Rams", "STL": "Rams",
        "LAC": "Chargers", "SD": "Chargers", "LV": "Raiders", "OAK": "Raiders", "MIA": "Dolphins", "MIN": "Vikings",
        "NE": "Patriots", "NO": "Saints", "NYG": "Giants", "NYJ": "Jets", "PHI": "Eagles", "PIT": "Steelers",
        "SEA": "Seahawks", "SF": "49ers", "TB": "Buccaneers", "TEN": "Titans", "WAS": "Washington"}


def clean(v):
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        if math.isnan(v) or math.isinf(v):
            return None
        return round(float(v), 4)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


def write(name: str, df: pd.DataFrame, notes: list[str]) -> None:
    rows = [{k: clean(v) for k, v in r.items()} for r in df.to_dict("records")]
    meta = [{"label": "Built by", "value": Path(__file__).read_text(), "type": "code", "lang": "python"}]
    meta += [{"label": "Note", "value": n} for n in notes]
    (OUT / f"{name}.json").write_text(json.dumps({"rows": rows, "meta": meta}, separators=(",", ":")))
    print(f"{name}: {len(rows)} rows, {(OUT / f'{name}.json').stat().st_size / 1024:.0f} KB")


NFLVERSE = ("https://github.com/nflverse/nflverse-data/releases/download/"
            "stats_player/stats_player_reg_{year}.parquet")


def add_other_position_rows(stats: pd.DataFrame, ids: set, first: int, last: int) -> pd.DataFrame:
    """Append nflverse season rows for these players that qb_season_stats.csv left out
    (any position label), with the same columns and derived rate stats."""
    cache = DATA / "nflverse_cache"
    cache.mkdir(exist_ok=True)
    have = set(zip(stats.player_id, stats.season))
    extra = []
    for year in range(max(first, FIRST_STATS_SEASON), last + 1):
        f = cache / f"stats_player_reg_{year}.parquet"
        if not f.exists():
            pd.read_parquet(NFLVERSE.format(year=year)).to_parquet(f)
        df = pd.read_parquet(f)
        df = df[df.player_id.isin(ids)]
        df = df[[(p, y) not in have for p, y in zip(df.player_id, df.season)]]
        if len(df):
            extra.append(df.rename(columns={"recent_team": "team", "passing_interceptions": "interceptions",
                                            "sacks_suffered": "sacks"}))
    if not extra:
        return stats
    ex = pd.concat(extra, ignore_index=True)
    lost = [c for c in ("rushing_fumbles_lost", "sack_fumbles_lost", "receiving_fumbles_lost") if c in ex]
    ex["fumbles_lost"] = ex["fumbles_lost_total"] if "fumbles_lost_total" in ex else ex[lost].fillna(0).sum(axis=1)
    ex["turnovers"] = ex.interceptions.fillna(0) + ex.fumbles_lost.fillna(0)
    att = ex.attempts.replace(0, np.nan)
    clamp = lambda v: v.clip(0, 2.375)
    ex["passer_rating"] = ((clamp((ex.completions / att - 0.3) * 5) + clamp((ex.passing_yards / att - 3) * 0.25)
                            + clamp(ex.passing_tds / att * 20) + clamp(2.375 - ex.interceptions / att * 25)) / 6 * 100).round(1)
    print(f"added {len(ex)} non-QB-labeled season rows for {ex.player_id.nunique()} players")
    return pd.concat([stats, ex[[c for c in stats.columns if c in ex.columns]]], ignore_index=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    season = pd.read_csv(DATA / "otc_profile_season_history_clean.csv")
    contracts = pd.read_csv(DATA / "otc_profile_contracts_clean.csv")
    dead = pd.read_csv(DATA / "otc_profile_dead_money.csv")
    players = pd.read_csv(DATA / "otc_profile_players_clean.csv")
    xwalk = pd.read_csv(DATA / "qb_players.csv")[["player_url", "gsis_id"]]
    summary = pd.read_csv(DATA / "qb_contracts.csv")
    stats = pd.read_csv(DATA / "qb_season_stats.csv")
    starts = pd.read_csv(DATA / "qb_game_starts.csv")
    pbp = pd.read_csv(DATA / "qb_season_pbp.csv")
    starts["franchise"] = starts.team.map(ABBR)
    assert starts.franchise.notna().all(), "unmapped team abbreviation"

    current = int(season.loc[~season.is_projected, "year"].max())

    # OTC inflation factor per year: inflated / nominal (exact per year on OTC)
    s = summary[(summary.inflated_value > 0) & (summary.value > 0)]
    factor = (s.inflated_value / s.value).groupby(s.year_signed).median()
    factor[current] = 1.0

    # ---- contracts ----------------------------------------------------------------
    c = contracts.copy()
    c["contract_class"] = np.where(c.contract_type.isin(ROOKIE_TYPES), "rookie", "veteran")
    key = ["player_url", "year_signed", "yrs", "total"]
    sm = summary.rename(columns={"years": "yrs", "value": "total"})
    sm = sm.drop_duplicates(key)[key + ["apy_pct_of_cap"]]
    n = len(c)
    c = c.merge(sm, on=key, how="left")
    assert len(c) == n, "summary join fanned out"
    loose = summary.rename(columns={"value": "total"}).drop_duplicates(["player_url", "year_signed", "total"])
    fill = c[["player_url", "year_signed", "total"]].merge(
        loose[["player_url", "year_signed", "total", "apy_pct_of_cap"]], how="left",
        on=["player_url", "year_signed", "total"])["apy_pct_of_cap"]
    c["apy_pct_of_cap"] = c["apy_pct_of_cap"].fillna(pd.Series(fill.values, index=c.index))
    c["inflation_factor"] = c.year_signed.map(factor)
    for col in ("total", "apy", "guarantees"):
        c[f"inflated_{col}"] = c[col] * c.inflation_factor
    c = c.sort_values(["player_url", "year_signed", "total"])
    c["contract_id"] = c.groupby("player_url").cumcount()
    c["contract_id"] = c.player_url.str.extract(r"/(\d+)/?$")[0] + "-" + c.contract_id.astype(str)

    signed = c[c.contract_type != "Practice"][["player_url", "team", "year_signed", "contract_type",
                                                "contract_class", "contract_id"]]

    def governing(url, team, year):
        rows = signed[(signed.player_url == url) & (signed.year_signed <= year)]
        if rows.empty:
            return None
        same = rows[rows.team == team]
        pick = (same if len(same) else rows).sort_values(["year_signed", "contract_id"]).iloc[-1]
        return pick

    # ---- seasons --------------------------------------------------------------------
    sh = season[~season.is_projected & ~season.is_void_year].copy()
    assert not sh.duplicated(["player_url", "year"]).any()
    gov = [governing(u, t, y) for u, t, y in zip(sh.player_url, sh.team, sh.year)]
    sh["contract_type"] = [g.contract_type if g is not None else None for g in gov]
    sh["contract_class"] = [g.contract_class if g is not None else "unknown" for g in gov]
    sh["contract_id"] = [g.contract_id if g is not None else None for g in gov]
    sh["inflation_factor"] = sh.year.map(factor)
    sh = sh.merge(xwalk, on="player_url", how="left")

    # qb_season_stats.csv keeps only rows nflverse labels QB. Some contracted QBs are labeled
    # TE/RB/WR in seasons they played there (Taysom Hill, Logan Thomas), so read those
    # players' rows from nflverse regardless of position.
    known = set(stats.player_id)
    extra_ids = set(sh.gsis_id.dropna()) - known
    extra_ids |= set(sh.gsis_id.dropna())  # also catch QBs' non-QB-labeled seasons
    st = add_other_position_rows(stats, extra_ids, sh.year.min(), current)
    st = st.rename(columns={"player_id": "gsis_id", "season": "year"})
    st["total_epa"] = st[["passing_epa", "rushing_epa"]].fillna(0).sum(axis=1)
    st["total_tds"] = st.passing_tds.fillna(0) + st.rushing_tds.fillna(0)
    keep = ["gsis_id", "year", "games", "completions", "attempts", "passing_yards", "passing_tds",
            "interceptions", "fumbles_lost", "turnovers", "sacks", "passing_epa", "rushing_epa", "total_epa", "passing_cpoe",
            "rushing_yards", "rushing_tds", "total_tds", "passer_rating", "team"]
    st = st[keep].rename(columns={"team": "stats_team"})
    n = len(sh)
    sh = sh.merge(st, on=["gsis_id", "year"], how="left")
    assert len(sh) == n, "stats join fanned out"
    sh["has_stats"] = sh.games.notna()
    in_window = sh.year >= FIRST_STATS_SEASON
    # wins/losses (as starter) and play-by-play stats, regular season and playoffs, by QB-year
    reg, post = starts[~starts.playoff], starts[starts.playoff]
    rec = lambda g, pre: g.assign(w=g.outcome.eq("W"), l=g.outcome.eq("L"), t=g.outcome.eq("T")).groupby(
        ["player_id", "season"]).agg(**{pre + "starts": ("game_id", "size"), pre + "wins": ("w", "sum"),
                                        pre + "losses": ("l", "sum"), pre + "ties": ("t", "sum")})
    wl = rec(reg, "").join(rec(post, "po_"), how="outer")
    sb = post[post.game_type == "SB"].assign(w=lambda g: g.outcome.eq("W")).groupby(["player_id", "season"]).agg(
        sb_starts=("game_id", "size"), sb_wins=("w", "sum"))
    wl = wl.join(sb, how="left")
    pb = pbp.groupby(["player_id", "season", "season_type"])[["wpa", "turnovers", "game_winning_drives",
                                                              "fourth_qtr_comebacks"]].sum().unstack("season_type")
    pb.columns = [("" if t == "REG" else "po_") + c for c, t in pb.columns]
    pb = pb.drop(columns=[c for c in ["turnovers"] if c in pb])  # regular-season turnovers come from the stats file
    extra = wl.join(pb, how="outer").reset_index().rename(columns={"player_id": "gsis_id", "season": "year"})
    n = len(sh)
    sh = sh.merge(extra, on=["gsis_id", "year"], how="left")
    assert len(sh) == n, "wins/pbp join fanned out"
    sh["franchise"] = sh.team.map(lambda t: OTC_FRANCHISE.get(t, t))

    # role on the team that season, from starts with that franchise
    tw = lambda g, pre: g.assign(w=g.outcome.eq("W"), l=g.outcome.eq("L"), t=g.outcome.eq("T")).groupby(
        ["player_id", "season", "franchise"]).agg(**{pre + "wins": ("w", "sum"), pre + "losses": ("l", "sum"), pre + "ties": ("t", "sum")})
    fs = reg.groupby(["player_id", "season", "franchise"]).size().rename("team_starts").to_frame()
    fs = fs.join(tw(reg, "team_")).join(tw(post, "team_po_"), how="left").fillna(0).astype(int).reset_index()
    fs["top"] = fs.team_starts == fs.groupby(["season", "franchise"]).team_starts.transform("max")
    fs = fs.rename(columns={"player_id": "gsis_id", "season": "year"})
    sh = sh.merge(fs, on=["gsis_id", "year", "franchise"], how="left")
    assert len(sh) == n, "team starts join fanned out"
    for col in ["team_starts", "team_wins", "team_losses", "team_ties", "team_po_wins", "team_po_losses", "team_po_ties"]:
        sh[col] = sh[col].fillna(0).astype(int)

    zero_cols = ["games", "completions", "attempts", "passing_yards", "passing_tds", "interceptions",
                 "fumbles_lost", "turnovers", "starts", "wins", "losses", "ties", "po_starts", "po_wins", "po_losses",
                 "po_ties", "sb_starts", "sb_wins", "wpa", "po_wpa", "po_turnovers", "game_winning_drives", "fourth_qtr_comebacks",
                 "sacks", "passing_epa", "rushing_epa", "total_epa", "rushing_yards", "rushing_tds", "total_tds"]
    for col in zero_cols:  # paid, 1999+, no stats row = zero production
        sh.loc[in_window & sh.gsis_id.notna() & ~sh.has_stats, col] = 0
    sh["stats_known"] = in_window & sh.gsis_id.notna()
    # how the QB arrived at this franchise, decided at the first season of each stint
    cinfo = c.set_index("contract_id")[["status", "team", "contract_type"]]
    order = {cid: i for i, cid in enumerate(c.contract_id)}
    by_player = c.groupby("player_url").contract_id.apply(list).to_dict()
    sh = sh.sort_values(["player_url", "year"]).reset_index(drop=True)
    prev_f = sh.groupby("player_url").franchise.shift()
    prev_y = sh.groupby("player_url").year.shift()
    new_stint = (sh.franchise != prev_f) | (sh.year - prev_y > 1)
    cyear = c.set_index("contract_id").year_signed
    def arrival_of(row):
        cid = row.contract_id
        if not isinstance(cid, str) or cid not in cinfo.index:
            return "unknown"
        # judge by the first contract with this franchise signed since the previous stint ended
        # (a later extension would hide that he came by trade)
        ids = by_player.get(row.player_url, [])
        fr = lambda x: OTC_FRANCHISE.get(cinfo.at[x, "team"], cinfo.at[x, "team"])
        upto = [i for i, x in enumerate(ids) if cyear[x] <= row.year]
        other = [i for i in upto if fr(ids[i]) != row.franchise]
        start = (max(other) + 1) if other else 0
        same = [ids[i] for i in upto if i >= start and fr(ids[i]) == row.franchise and cinfo.at[ids[i], "contract_type"] != "Practice"]
        if same:
            cid = same[0]
        ctype, cteam = cinfo.at[cid, "contract_type"], OTC_FRANCHISE.get(cinfo.at[cid, "team"], cinfo.at[cid, "team"])
        if ctype in ROOKIE_TYPES and cteam == row.franchise:
            return "homegrown"
        ids = by_player.get(row.player_url, [])
        i = ids.index(cid) if cid in ids else -1
        if i > 0 and cinfo.at[ids[i - 1], "status"] == "Traded":
            return "traded"
        return "signed"
    sh["arrival"] = None
    sh.loc[new_stint, "arrival"] = [arrival_of(r) for r in sh[new_stint].itertuples()]
    sh["arrival"] = sh.groupby((new_stint).cumsum()).arrival.transform("first")
    # starts made for another franchise the same season (traded or released mid-season)
    sh["other_team_starts"] = (sh.starts.fillna(0) - sh.team_starts).clip(lower=0).astype(int)

    sh["role"] = np.select(
        [~sh.stats_known, sh.top.fillna(False).astype(bool), sh.team_starts > 0, sh.games > 0],
        ["unknown", "starter", "spot", "backup"], "inactive")
    sh = sh[["player_url", "player", "gsis_id", "year", "team", "contract_class", "contract_type", "contract_id",
             "cap_number", "cap_pct", "cash_paid", "base_salary", "guaranteed_salary", "inflation_factor",
             "stats_known", "has_stats", "stats_team", "franchise", "role", "team_starts", "team_wins", "team_losses", "team_ties",
             "team_po_wins", "team_po_losses", "arrival", "other_team_starts"]
            + zero_cols + ["passing_cpoe", "passer_rating"]]

    # ---- dead money -----------------------------------------------------------------
    d = dead[dead.year <= current].copy()
    gov = [governing(u, t, y) for u, t, y in zip(d.player_url, d.team, d.year)]
    d["contract_class"] = [g.contract_class if g is not None else "unknown" for g in gov]
    d["contract_type"] = [g.contract_type if g is not None else None for g in gov]
    d["contract_id"] = [g.contract_id if g is not None else None for g in gov]
    d["inflation_factor"] = d.year.map(factor)
    d["franchise"] = d.team.map(lambda t: OTC_FRANCHISE.get(t, t))
    EXIT = {"Traded": "traded", "Terminated": "released", "June 1 Terminated": "released", "Claimed": "released",
            "Expired": "void", "Reserve": "retired"}
    st_ = d.contract_id.map(cinfo.status)
    same_team = d.contract_id.map(cinfo.team).map(lambda t: OTC_FRANCHISE.get(t, t) if isinstance(t, str) else t) == d.franchise
    d["exit"] = st_.map(EXIT).where(same_team, "other").fillna("other")

    # ---- team seasons (team page): record and who started -----------------------------
    def team_rec(g, pre):
        g = g.assign(w=g.outcome.eq("W"), l=g.outcome.eq("L"), t=g.outcome.eq("T"))
        return g.groupby(["franchise", "season"]).agg(**{pre + "games": ("game_id", "size"), pre + "wins": ("w", "sum"),
                                                        pre + "losses": ("l", "sum"), pre + "ties": ("t", "sum")})
    ts = team_rec(reg, "").join(team_rec(post, "po_"), how="left").fillna(0).astype(int)
    ts["starters"] = reg.groupby(["franchise", "season"]).player_id.nunique()
    ts = ts.reset_index().rename(columns={"season": "year"})
    ts = ts[ts.year <= current]

    # ---- players --------------------------------------------------------------------
    pl = players.merge(xwalk, on="player_url", how="left")
    pl["has_season_history"] = pl.player_url.isin(sh.player_url)
    pl["has_stats"] = pl.gsis_id.isin(stats.player_id)
    pl = pl[["player_url", "player", "gsis_id", "entry", "entry_year", "entry_type", "entry_round", "entry_pick",
             "entry_team", "college", "career_earnings", "career_apy", "total_guarantees", "current_contract",
             "has_season_history", "has_stats"]]

    # ---- checks ---------------------------------------------------------------------
    built = (sh[sh.year < current].groupby("player_url").cash_paid.sum()
             .add(d[d.year < current].groupby("player_url").cash_paid.sum(), fill_value=0))
    cmp = pd.DataFrame({"built": built, "career": players.set_index("player_url").career_earnings}).dropna()
    ok = (cmp.built - cmp.career).abs() <= 1000
    print(f"cash reconciles with OTC career earnings for {ok.sum()}/{len(cmp)} QBs (seasons before {current})")
    print("worst misses:\n", (cmp.built - cmp.career)[~ok].abs().sort_values(ascending=False).head(8))
    for name in ["Joe Burrow", "Patrick Mahomes", "Brock Purdy", "Brett Favre", "Kurt Warner"]:
        r = sh[sh.player == name][["year", "team", "contract_class", "contract_type", "cash_paid"]]
        print(name, r.values.tolist()[:12])

    caps = pd.DataFrame({"year": factor.index.astype(int), "inflation_factor": factor.values})
    notes_common = [f"Current season: {current} (in progress)."]
    write("seasons", sh, notes_common + ["One row per QB season from OTC season history, joined to nflverse stats."])
    write("dead_money", d, notes_common + ["Dead money by team and year from OTC player profiles."])
    write("contracts", c[["contract_id", "player_url", "player", "team", "contract_type", "contract_class", "status",
                          "year_signed", "yrs", "total", "apy", "guarantees", "amount_earned", "pct_earned",
                          "effective_apy", "apy_pct_of_cap", "inflation_factor", "inflated_total", "inflated_apy",
                          "inflated_guarantees"]], notes_common)
    write("players", pl, notes_common)
    write("team_seasons", ts, notes_common + ["Team record by season from nflverse games (completed games only)."])
    print("roles:", sh[sh.year >= FIRST_STATS_SEASON].role.value_counts().to_dict())
    print("arrival:", sh[sh.year >= FIRST_STATS_SEASON].arrival.value_counts().to_dict())
    print("dead exit $M:", (d.groupby("exit").cap_charge.sum() / 1e6).round(0).to_dict())
    for name in ["Russell Wilson", "Baker Mayfield", "Deshaun Watson", "Kirk Cousins"]:
        print(name, sh[sh.player == name][["year", "franchise", "arrival", "role"]].values.tolist()[-8:])
    write("cap_factors", caps, ["OTC inflation factor: current-season cap divided by that year's cap."])

    # site settings the page reads instead of hardcoding years and the cap
    # a season is complete once its Super Bowl is in the games data
    season_done = bool(((starts.season == current) & (starts.game_type == "SB")).any())
    cap_year, cap_amount = LEAGUE_CAP
    meta = pd.DataFrame([{
        "current_season": current,
        "last_complete_season": current if season_done else current - 1,
        "first_season": int(sh.year.min()),
        "first_stats_season": FIRST_STATS_SEASON,
        "cap_current": round(cap_amount * float(factor.loc[cap_year])),
    }])
    write("meta", meta, [f"Current cap = the {cap_year} league cap (${cap_amount / 1e6:.1f}M) times OTC's {cap_year} "
                         "inflation factor, i.e. the current-season cap OTC's inflated dollars are expressed in."])


if __name__ == "__main__":
    main()
