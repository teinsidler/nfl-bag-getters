"""Prototype: QB-season WPA and 4QC/GWD approximation from nflverse pbp.
Usage: python -I clutch_proto.py <pbp.parquet> [season_type=REG|POST|ALL]"""
import sys, time
import pandas as pd

t0 = time.time()
path = sys.argv[1]
stype = sys.argv[2] if len(sys.argv) > 2 else "REG"
COLS = ["game_id", "season", "season_type", "play_id", "posteam", "defteam", "home_team",
        "away_team", "qtr", "fixed_drive", "fixed_drive_result", "total_home_score",
        "total_away_score", "home_score", "away_score", "passer_player_id",
        "passer_player_name", "rusher_player_id", "qb_dropback", "qb_scramble",
        "wpa", "qb_epa", "wp", "play_type", "two_point_attempt"]
df = pd.read_parquet(path, columns=COLS)
if stype != "ALL":
    df = df[df.season_type == stype]
df = df.sort_values(["game_id", "play_id"]).reset_index(drop=True)

# ---------------- (a) QB WPA / EPA ----------------
# Dropback plays (passes, sacks, scrambles) credited to passer_player_id (scrambles carry
# passer id in nflverse), plus designed QB runs: rusher id == a known passer id.
pc = df.passer_player_id.value_counts()
qbs = set(pc[pc >= 50].index)          # real QBs only (drops RB/WR trick passers)
df["qb_id"] = df.passer_player_id.where(df.passer_player_id.isin(qbs),
                                        df.rusher_player_id.where(df.rusher_player_id.isin(qbs)))
# high leverage: start-of-play WP between .2 and .8 in Q4/OT
df["hi_lev"] = (df.qtr >= 4) & df.wp.between(0.2, 0.8)
q = df[df.qb_id.notna()]
wpa = q.groupby("qb_id").agg(name=("passer_player_name", lambda s: s.dropna().mode().iat[0] if s.notna().any() else None),
                             plays=("wpa", "size"), wpa=("wpa", "sum"), qb_epa=("qb_epa", "sum"))
wpa["hi_lev_epa"] = q[q.hi_lev].groupby("qb_id").qb_epa.sum()
wpa["hi_lev_wpa"] = q[q.hi_lev].groupby("qb_id").wpa.sum()

# ---------------- (b) 4QC / GWD ----------------
# drive table (offense perspective)
# running totals are monotonic; cummax repairs stale totals on timeout/no_play rows
g = df.groupby("game_id")
df["hdiff"] = g.total_home_score.cummax() - g.total_away_score.cummax()   # after the play
df["hdiff_pre"] = g.hdiff.shift(1).fillna(0)
drv = df[df.posteam.notna()].groupby(["game_id", "fixed_drive"]).agg(
    posteam=("posteam", "first"), home=("home_team", "first"),
    q_end=("qtr", "max"), result=("fixed_drive_result", "first"),
    pre=("hdiff_pre", "first"), post=("hdiff", "last"),
    qb=("qb_id", lambda s: s.dropna().mode().iat[0] if s.notna().any() else None)).reset_index()
sgn = (drv.posteam == drv.home).map({True: 1, False: -1})
drv["pre"] *= sgn          # offense margin at drive start
drv["post"] *= sgn         # offense margin after drive (incl. PAT/2pt)
drv["off_score"] = drv.result.isin(["Touchdown", "Field goal"])

fin = g.agg(home=("home_team", "first"), away=("away_team", "first"),
            hs=("home_score", "first"), as_=("away_score", "first"))
fin["winner"] = fin.home.where(fin.hs > fin.as_, fin.away.where(fin.as_ > fin.hs))  # NaN = tie

# GWD: the play that gave the winner its final lead; credit if it came on the winner's own
# offensive TD/FG drive ending in Q4/OT and the winner was tied/down 1-8 before it.
rows = []
for gid, gd in df.groupby("game_id", sort=False):
    w = fin.at[gid, "winner"]
    if pd.isna(w):
        continue
    s = 1 if w == fin.at[gid, "home"] else -1
    m = gd.hdiff.values * s
    mp = gd.hdiff_pre.values * s
    idx = [i for i in range(len(m)) if m[i] > 0 and mp[i] <= 0]
    if not idx:
        continue
    i = idx[-1]
    fd = gd.fixed_drive.iat[i]
    d = drv[(drv.game_id == gid) & (drv.fixed_drive == fd)]
    if len(d) and d.posteam.iat[0] == w and d.off_score.iat[0] and d.q_end.iat[0] >= 4 \
            and -8 <= mp[i] <= 0:
        rows.append(("GWD", gid, w, d.qb.iat[0]))
# 4QC: team won or tied AND had an offensive TD/FG drive ending in Q4/OT that began while
# trailing. Credit QB of the last such drive.
d4 = drv[drv.off_score & (drv.q_end >= 4) & (drv.pre < 0)].merge(fin[["winner"]], left_on="game_id", right_index=True)
d4 = d4[(d4.winner == d4.posteam) | d4.winner.isna()]
for (gid, team), x in d4.groupby(["game_id", "posteam"]):
    rows.append(("4QC", gid, team, x.qb.iat[-1]))
cl = pd.DataFrame(rows, columns=["stat", "game_id", "team", "qb_id"])
if len(sys.argv) > 3: print(cl[cl.team == sys.argv[3]].sort_values("game_id").to_string())
cnt = cl.pivot_table(index="qb_id", columns="stat", values="game_id", aggfunc="count").fillna(0).astype(int)
out = wpa.join(cnt, how="left").fillna({"4QC": 0, "GWD": 0})
out = out[out.plays >= 200].sort_values("wpa", ascending=False)
pd.set_option("display.width", 200, "display.max_rows", 80)
print(out.round(2).head(45))
print(f"runtime {time.time()-t0:.1f}s")
out.to_csv(path.replace(".parquet", f"_{stype}_clutch.csv"))
