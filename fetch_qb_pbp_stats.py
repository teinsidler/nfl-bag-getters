"""QB win probability added (WPA), clutch drives and turnovers from nflverse play-by-play.

Season stats files don't carry win probability or playoff splits, so this reads the
play-by-play files (one per season, ~13-21 MB each, 1999 on) and writes one row per QB
per team per season per season type (REG or POST):

  data/qb_season_pbp.csv
    plays            dropbacks (passes, sacks, scrambles) plus designed QB runs
    wpa              sum of win probability added on those plays (in wins)
    qb_epa           sum of expected points added on those plays
    interceptions, fumbles_lost, turnovers (= the two added)
    fourth_qtr_comebacks, game_winning_drives  (Pro-Football-Reference definitions,
                     approximated from scores and drives; see research/report_clutch.md)

Files are cached in data/nflverse_cache/pbp/ (about 0.5 GB for every season); pass
--refresh to download again. Only completed games are in the files, so the current
season is partial.

Method notes:
- A "QB" is anyone with 50+ pass plays in that season, so trick passes by running backs
  and receivers don't create QB rows. Designed runs count for those players too.
- The running score columns go stale on timeout/no-play rows; a per-game cummax repairs them.
- Each scoring drive is credited to the QB who took most of its plays.
"""
import sys
import time
from pathlib import Path

import pandas as pd
import requests

DATA = Path(__file__).parent / "data"
CACHE = DATA / "nflverse_cache" / "pbp"
URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{}.parquet"
FIRST = 1999
COLS = ["game_id", "season", "season_type", "play_id", "posteam", "home_team", "away_team",
        "qtr", "fixed_drive", "fixed_drive_result", "total_home_score", "total_away_score",
        "home_score", "away_score", "passer_player_id", "passer_player_name", "rusher_player_id",
        "wpa", "qb_epa", "interception", "fumble_lost", "fumbled_1_player_id", "fumbled_2_player_id"]


def load(year: int, refresh: bool) -> pd.DataFrame:
    path = CACHE / f"play_by_play_{year}.parquet"
    if refresh or not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        r = requests.get(URL.format(year), timeout=120)
        r.raise_for_status()
        path.write_bytes(r.content)
    return pd.read_parquet(path, columns=COLS)


def season_rows(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["game_id", "play_id"]).reset_index(drop=True)
    pc = df.passer_player_id.value_counts()
    qbs = set(pc[pc >= 50].index)
    df["qb_id"] = df.passer_player_id.where(df.passer_player_id.isin(qbs),
                                            df.rusher_player_id.where(df.rusher_player_id.isin(qbs)))

    # WPA / EPA / turnovers (a fumble counts against the QB only if he fumbled it)
    q = df[df.qb_id.notna()].copy()
    q["int"] = (q.interception == 1) & (q.passer_player_id == q.qb_id)
    q["fl"] = (q.fumble_lost == 1) & ((q.fumbled_1_player_id == q.qb_id) | (q.fumbled_2_player_id == q.qb_id))
    out = q.groupby(["qb_id", "season_type", "posteam"]).agg(
        plays=("play_id", "size"), wpa=("wpa", "sum"), qb_epa=("qb_epa", "sum"),
        interceptions=("int", "sum"), fumbles_lost=("fl", "sum"))
    names = q.dropna(subset=["passer_player_name"]).groupby("qb_id").passer_player_name.agg(lambda s: s.mode().iat[0])

    # drives, from the offense's point of view
    g = df.groupby("game_id")
    df["hdiff"] = g.total_home_score.cummax() - g.total_away_score.cummax()
    df["hdiff_pre"] = df.groupby("game_id").hdiff.shift(1).fillna(0)
    drv = df[df.posteam.notna()].groupby(["game_id", "fixed_drive"]).agg(
        season_type=("season_type", "first"), posteam=("posteam", "first"), home=("home_team", "first"),
        q_end=("qtr", "max"), result=("fixed_drive_result", "first"), pre=("hdiff_pre", "first"),
        qb=("qb_id", lambda s: s.dropna().mode().iat[0] if s.notna().any() else None)).reset_index()
    sgn = (drv.posteam == drv.home).map({True: 1, False: -1})
    drv["pre"] *= sgn
    drv["off_score"] = drv.result.isin(["Touchdown", "Field goal"])
    fin = g.agg(home=("home_team", "first"), away=("away_team", "first"),
                hs=("home_score", "first"), as_=("away_score", "first"))
    fin["winner"] = fin.home.where(fin.hs > fin.as_, fin.away.where(fin.as_ > fin.hs))

    events = []
    # game-winning drive: the winner's own TD/FG drive ending in Q4/OT that took the final lead
    # from a tie or a 1-8 point deficit
    for gid, gd in df.groupby("game_id", sort=False):
        w = fin.at[gid, "winner"]
        if pd.isna(w):
            continue
        s = 1 if w == fin.at[gid, "home"] else -1
        m, mp = gd.hdiff.values * s, gd.hdiff_pre.values * s
        idx = [i for i in range(len(m)) if m[i] > 0 and mp[i] <= 0]
        if not idx:
            continue
        i = idx[-1]
        d = drv[(drv.game_id == gid) & (drv.fixed_drive == gd.fixed_drive.iat[i])]
        if len(d) and d.posteam.iat[0] == w and d.off_score.iat[0] and d.q_end.iat[0] >= 4 and -8 <= mp[i] <= 0:
            events.append(("game_winning_drives", d.qb.iat[0], d.season_type.iat[0], w))
    # fourth-quarter comeback: won or tied, with a TD/FG drive ending in Q4/OT that began trailing
    d4 = drv[drv.off_score & (drv.q_end >= 4) & (drv.pre < 0)].merge(fin[["winner"]], left_on="game_id", right_index=True)
    d4 = d4[(d4.winner == d4.posteam) | d4.winner.isna()]
    for (_, team), x in d4.groupby(["game_id", "posteam"]):
        events.append(("fourth_qtr_comebacks", x.qb.iat[-1], x.season_type.iat[-1], team))
    ev = pd.DataFrame(events, columns=["stat", "qb_id", "season_type", "posteam"]).dropna(subset=["qb_id"])
    if len(ev):
        cnt = ev.pivot_table(index=["qb_id", "season_type", "posteam"], columns="stat", aggfunc="size")
        out = out.join(cnt, how="left")
    for c in ("fourth_qtr_comebacks", "game_winning_drives"):
        if c not in out:
            out[c] = 0
    out = out.fillna({"fourth_qtr_comebacks": 0, "game_winning_drives": 0}).reset_index()
    out["player_name"] = out.qb_id.map(names)
    out["season"] = int(df.season.iat[0])
    return out


def main(refresh: bool = False) -> None:
    last = pd.Timestamp.today().year
    frames = []
    for year in range(FIRST, last + 1):
        t = time.time()
        try:
            df = load(year, refresh)
        except requests.HTTPError as e:
            print(f"{year}: not available ({e})")
            continue
        frames.append(season_rows(df))
        print(f"{year}: {len(frames[-1])} QB rows ({time.time() - t:.1f}s)")
    out = pd.concat(frames, ignore_index=True).rename(columns={"qb_id": "player_id", "posteam": "team"})
    out["turnovers"] = out.interceptions + out.fumbles_lost
    for c in ("interceptions", "fumbles_lost", "turnovers", "fourth_qtr_comebacks", "game_winning_drives"):
        out[c] = out[c].astype(int)
    out["wpa"] = out.wpa.round(3)
    out["qb_epa"] = out.qb_epa.round(2)
    cols = ["player_id", "player_name", "season", "season_type", "team", "plays", "wpa", "qb_epa",
            "interceptions", "fumbles_lost", "turnovers", "fourth_qtr_comebacks", "game_winning_drives"]
    out = out[cols].sort_values(["season", "season_type", "wpa"], ascending=[True, False, False])
    out.to_csv(DATA / "qb_season_pbp.csv", index=False)
    reg = out[out.season_type == "REG"]
    print(f"\n{len(out)} rows. Top regular-season WPA:")
    print(reg.nlargest(5, "wpa")[["player_name", "season", "team", "wpa", "game_winning_drives"]].to_string(index=False))
    car = out.groupby(["player_id", "season_type"]).wpa.sum().unstack()
    car["name"] = out.groupby("player_id").player_name.last()
    print("\nCareer playoff WPA leaders:")
    print(car.nlargest(5, "POST")[["name", "REG", "POST"]].round(1).to_string())


if __name__ == "__main__":
    main(refresh="--refresh" in sys.argv)
