# Clutch / win-impact stats from nflverse pbp: findings

## Definitions (PFR, Scott Kacsmar's rules: https://www.pro-football-reference.com/about/comebacks.htm)
- **4QC**: the team wins or ties, and at some point has an offensive scoring drive while trailing in the 4th quarter or OT.
- **GWD**: the team wins, and has an offensive scoring drive in the 4th quarter or OT that gives it its final lead, starting from a tie or a deficit of one score (1-8 points). The drive may start in Q3 if it ends in Q4.
- Points from defensive or special-teams scores don't count, and the credit goes to the QB of that drive. A game can be a 4QC without being a GWD, and the reverse is also true (for example, a winning drive from a tie).
- PFR returns 403 to automated fetches, so I took the wording from search snippets of that page. I didn't read it directly.

## Prototype results (2022 and 2023 regular season, 1.3-1.5 s per season)
**Validation against PFR's published numbers:**
| QB season | PFR 4QC/GWD | Prototype |
|---|---|---|
| Cousins 2022 | 8 / 8 (tied the record) | 8 / 8 |
| G. Smith 2023 | 4 / 5 (led the league in GWD) | 4 / 5 |
| R. Wilson 2023 | 4 / ? | 4 / 4 |
| D. Jones 2022 | ? / 5 (reported) | 4 / 5 |
| Burrow 2022 | ? / "four this season" (reported in Dec.) | 3 / 4 |

- Every published figure I could find matches. Fuller validation would need PFR's season tables, which it won't serve to automated fetches.
- **One bug found and fixed.** The first version gave Cousins 6 GWD. On timeout and no_play rows, `total_home_score`/`total_away_score` carry stale pre-score values, and those rows sort after the scoring play by `play_id`. That made the lead look like it changed hands again. Taking a per-game `cummax()` of the running totals fixed it.
- **Other known edge cases:**
  - QB credit goes to the most common passer on the drive, so a mid-drive QB swap could be misattributed.
  - Ties count toward 4QC, per the PFR rule.
  - My "Q4" check uses the quarter the drive ended in, which matches PFR's Q3-start allowance.
- **WPA:** Plays are credited to passer_player_id plus QB runs. To exclude trick passers, a passer must have at least 50 pass plays in the season; without that filter, McCaffrey and Henry showed up as "QBs".
- **2022 WPA leaders:** Mahomes +5.8, Allen +3.4, Hurts +3.3.
- **2023 WPA leaders:** Allen +3.8, Goff +3.5, Prescott +3.4.
- **High-leverage EPA:** qb_epa summed over Q4/OT plays that start with WP between 0.2 and 0.8. It's noisy (Burrow 2022 +31, Hurts 2023 +25) and depends on sample size.

## Data size, runtime and column coverage
- pbp parquet files run 13 MB (1999) to 21 MB (2025), **516 MB in total for all 27 seasons**.
- Each download took under 1 s here. Reads take about 0.25 s per season, and the prototype about 1.5 s, so the full run is about 1 minute plus downloads. Reading only the needed `columns=` keeps memory small.
- I checked coverage on 2005, 2022 and 2023 (I downloaded 2005 for a coverage check only, then deleted it). Coverage is essentially identical:

| Column | Coverage |
|---|---|
| wpa, vegas_wpa, qb_epa | about 98.6% of rows |
| wp | 99.4% |
| fixed_drive, fixed_drive_result, qtr, sp | 100% |
| total_home/away_score | present on every play (stale on some admin rows) |
| passer_player_id | about 40% of rows, i.e. all pass plays |
| drive_quarter_end | present |

- The missing values are non-plays such as timeouts and quarter ends.
- nflfastR models these columns for every season from 1999 on, so I expect the same coverage in all 27 years, but **I didn't verify 1999-2004 directly**.
- Caveat: before about 2006 the pbp is thinner (fewer charted fields), so EPA/WP models are less reliable there, though still usable.
- Playoffs: the same code runs on `season_type == 'POST'`. Pass `ALL` to the script, or split by season_type for a separate playoff 4QC/GWD/WPA line.

## Recommendation
1. **Add QB season WPA (sum)** as the main clutch/win-impact metric. It's cheap, covers 1999-2025, and is already scaled to wins, which suits "money per win produced". Pair it with total qb_epa for context.
2. **Add 4QC and GWD counts** (regular season plus a playoff split). The approximation reproduced every PFR number I could verify. They're familiar but noisy, and they depend on the defense and the opponent too, so show them alongside other stats and don't weight them heavily.
3. **Playoff production:** add playoff WPA, qb_epa and GWD from the same pass. Playoff W-L comes from the other games.csv script, so don't duplicate it.
4. **High-leverage EPA:** optional, or a tooltip only. It's too noisy for ranking.
5. Before shipping, spot-check 4QC/GWD for about 5 more QB seasons, ideally pre-2005, against PFR's player pages by hand, since PFR blocks scraping.

## Prototype code
Full script: `research/clutch_proto.py`. To run it: `python -I clutch_proto.py play_by_play_YYYY.parquet [REG|POST|ALL] [TEAM]`. Core section below.
```python
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
```
