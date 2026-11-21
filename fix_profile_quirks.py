"""Clean known quirks in the OTC profile scrape. Run after fetch_qb_profiles.py.

Reads (never modifies):
  data/otc_profile_players.csv, data/otc_profile_contracts.csv,
  data/otc_profile_current_contract.csv, data/otc_profile_season_history.csv,
  data/qb_contracts.csv, data/manual_overrides.csv
Writes:
  data/otc_profile_players_clean.csv
  data/otc_profile_contracts_clean.csv
  data/otc_profile_current_contract_clean.csv
  data/otc_profile_season_history_clean.csv

Outputs are separate *_clean.csv files so the script is a pure function of the raw
scrape + overrides: re-running it (or re-running the scraper and then it) always
gives the same result, and raw OTC values stay available for auditing.

Fixes:
  1. Entry info overrides (Leinart '2 Draft', Kolb / Archer missing entry).
  2. QBs whose OTC Contract History table is empty get their qb_contracts.csv
     summary row(s) added, with contract_type classified by rule:
       UDFA  - undrafted, signed in entry year with entry franchise, >= 3 years
       Drafted - drafted, signed in entry year with entry franchise
       UFA   - re-signed by the team he was on (non-practice-squad salary) the prior season
       SFA   - everything else (street / reserve-future / minimum deals)
  3. Rule fixes on OTC rows:
       Drafted/UDFA signed after the entry year (not a supplemental-draft pick) -> SFA
       undrafted player with no rookie row whose first 3+-yr deal was signed in his
       entry year with his entry franchise -> UDFA
  4. Manual overrides (data/manual_overrides.csv), guarded by expected_old.
  5. is_rookie_contract recomputed as contract_type in {Drafted, UDFA}.
  6. 'Void' salary cells -> NaN with is_void_year flag; season-history placeholder
     salaries in void years -> NaN; is_projected = year > current season.
"""
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).parent / "data"
ROOKIE_TYPES = {"Drafted", "UDFA"}
MIN_VET_SALARY = 400_000  # below this a prior-season salary is practice-squad pay

# old team names -> current franchise nickname (OTC mixes both)
FRANCHISE = {"Redskins": "Commanders", "Washington": "Commanders", "Football Team": "Commanders",
             "Oilers": "Titans"}


def franchise(team):
    if not isinstance(team, str):
        return team
    return FRANCHISE.get(team.strip(), team.strip())


def norm(v):
    """Canonical string for comparing override values to cell values."""
    if v is None or (isinstance(v, float) and np.isnan(v)) or v is pd.NA:
        return ""
    if isinstance(v, (int, float, np.integer, np.floating)):
        f = float(v)
        return str(int(f)) if f.is_integer() else str(f)
    s = str(v).strip()
    try:
        f = float(s)
        return str(int(f)) if f.is_integer() else s
    except ValueError:
        return s


def current_season(players: pd.DataFrame) -> int:
    for col in players.columns:
        if m := re.match(r"(\d{4})_salary_cap_charge$", col):
            return int(m.group(1))
    raise SystemExit("cannot infer current season from otc_profile_players.csv columns")


# ----------------------------------------------------------------------------- overrides
def apply_overrides(df, ov, table, log):
    df = df.copy()
    for _, o in ov[ov["table"] == table].iterrows():
        mask = df["player_url"] == o["player_url"]
        if table == "contracts":
            mask &= df["team"] == o["match_team"]
            mask &= df["year_signed"].map(norm) == norm(o["match_year_signed"])
            mask &= df["total"].map(norm) == norm(o["match_total"])
        n = int(mask.sum())
        if n == 0:
            log.append((o["override_id"], "UNMATCHED (OTC data changed upstream?)"))
            continue
        if o["action"] == "drop_row":
            df = df[~mask]
            log.append((o["override_id"], f"dropped {n} row(s)"))
            continue
        field, new = o["field"], o["new_value"]
        cur = df.loc[mask, field].map(norm)
        if (cur == norm(new)).all():
            status = "already correct"
        elif o["expected_old"] != "" and not (cur == norm(o["expected_old"])).all():
            log.append((o["override_id"], f"SKIPPED: {field}={list(cur)} != expected {o['expected_old']!r}"))
            continue
        else:
            status = f"set {field}: {list(cur)} -> {new}"
        if pd.api.types.is_numeric_dtype(df[field]):
            df.loc[mask, field] = float(new)
        else:
            df.loc[mask, field] = new
        if table == "contracts" and field == "contract_type":
            df.loc[mask, "contract_type_source"] = "manual"
        log.append((o["override_id"], status))
    return df


# ----------------------------------------------------------------------------- contracts
def synthesize_missing(players, contracts, qb, season):
    """Rows for players whose OTC Contract History table is empty, from qb_contracts.csv."""
    missing = players[~players.player_url.isin(contracts.player_url)]
    q = qb[qb.player_url.isin(missing.player_url)].merge(
        players[["player_url", "entry_year", "entry_type", "entry_team"]], on="player_url", how="left")
    rows = []
    for _, r in q.iterrows():
        same_year = r.entry_year == r.year_signed
        same_team = (not isinstance(r.entry_team, str)) or franchise(r.entry_team) == franchise(r.team)
        prev = season[(season.player_url == r.player_url) & (season.year == r.year_signed - 1)]
        prev_same = prev[(prev.team.map(franchise) == franchise(r.team)) & (prev.base_salary >= MIN_VET_SALARY)]
        if r.entry_type == "Undrafted" and same_year and same_team and r.years >= 3:
            ctype = "UDFA"
        elif r.entry_type in ("Draft", "Supplemental Draft") and same_year and same_team:
            ctype = "Drafted"
        elif len(prev_same):
            ctype = "UFA"
        else:
            ctype = "SFA"
        rows.append({"player": r.player, "player_url": r.player_url, "team": r.team,
                     "contract_type": ctype, "status": np.nan, "year_signed": r.year_signed,
                     "yrs": r.years, "total": float(r.value), "apy": float(r.apy),
                     "guarantees": float(r.guaranteed), "contract_type_source": "rule",
                     "row_source": "qb_contracts_summary"})
    return pd.DataFrame(rows)


def rule_fix_otc_rows(c, players):
    c = c.merge(players[["player_url", "entry_year", "entry_type", "entry_team"]], on="player_url", how="left")
    # (a) "rookie" deal signed after the entry year -> not a rookie deal
    late = (c.contract_type.isin(ROOKIE_TYPES) & c.entry_year.notna() & (c.year_signed > c.entry_year)
            & (c.entry_type != "Supplemental Draft") & (c.contract_type_source == "otc"))
    c.loc[late, ["contract_type", "contract_type_source"]] = ["SFA", "rule"]
    # (b) undrafted player with no rookie row: first 3+-yr deal in entry year with entry franchise
    has_rookie = c[c.contract_type.isin(ROOKIE_TYPES)].player_url.unique()
    cand = (~c.player_url.isin(has_rookie) & (c.entry_type == "Undrafted") & (c.year_signed == c.entry_year)
            & (c.team.map(franchise) == c.entry_team.map(franchise)) & (c.yrs >= 3)
            & c.contract_type.isin(["SFA", "UFA"]))
    c.loc[cand, ["contract_type", "contract_type_source"]] = ["UDFA", "rule"]
    return c.drop(columns=["entry_year", "entry_type", "entry_team"])


# ----------------------------------------------------------------------------- void / projected
def clean_current(cc, cur):
    cc = cc.copy()
    void_cells = cc.astype(str).eq("Void")
    cc["is_void_year"] = void_cells.any(axis=1)
    cc["void_columns"] = void_cells.apply(lambda r: ";".join(r.index[r]), axis=1).replace("", np.nan)
    num_cols = [c for c in cc.columns if c not in
                ("player", "player_url", "contract_trigger", "is_void_year", "void_columns")]
    for col in num_cols:
        cc[col] = pd.to_numeric(cc[col].replace("Void", np.nan), errors="raise")
    cc["is_projected"] = cc["year"] > cur
    return cc


def clean_season(sh, cc_clean, cur):
    sh = sh.copy()
    voids = cc_clean.loc[cc_clean.is_void_year, ["player_url", "year", "void_columns"]]
    sh = sh.merge(voids, on=["player_url", "year"], how="left")
    sh["is_void_year"] = sh["void_columns"].notna()
    # OTC season history shows contractual placeholder salaries (e.g. $99,999,999) in
    # void years; they are never paid, so blank them wherever current_contract says Void.
    for i in sh.index[sh.is_void_year]:
        for col in set(sh.at[i, "void_columns"].split(";")) | {"base_salary"}:
            if col in sh.columns:
                sh.at[i, col] = np.nan
    sh = sh.drop(columns="void_columns")
    sh["is_projected"] = sh["year"] > cur
    return sh


# ----------------------------------------------------------------------------- main
def main():
    players = pd.read_csv(DATA / "otc_profile_players.csv")
    contracts = pd.read_csv(DATA / "otc_profile_contracts.csv")
    cc = pd.read_csv(DATA / "otc_profile_current_contract.csv", dtype=str)
    sh = pd.read_csv(DATA / "otc_profile_season_history.csv")
    qb = pd.read_csv(DATA / "qb_contracts.csv")
    ov = pd.read_csv(DATA / "manual_overrides.csv", dtype=str, keep_default_na=False)
    cur = current_season(players)
    log = []

    # players
    p = apply_overrides(players, ov, "players", log)

    # contracts
    c = contracts.copy()
    c["otc_contract_type"] = c["contract_type"]
    c["contract_type_source"] = "otc"
    c["row_source"] = "otc_profile"
    c = rule_fix_otc_rows(c, p)
    syn = synthesize_missing(p, contracts, qb, sh)
    c = pd.concat([c, syn], ignore_index=True)
    c = apply_overrides(c, ov, "contracts", log)
    c["is_rookie_contract"] = c["contract_type"].isin(ROOKIE_TYPES)
    c = c.sort_values(["player", "year_signed", "row_source"], kind="stable").reset_index(drop=True)

    # flags on players
    p["has_contract_history"] = p.player_url.isin(contracts.player_url)
    p["has_rookie_contract_row"] = p.player_url.isin(c.loc[c.is_rookie_contract, "player_url"])

    cc_clean = clean_current(cc, cur)
    sh_clean = clean_season(sh, cc_clean, cur)

    p.to_csv(DATA / "otc_profile_players_clean.csv", index=False)
    c.to_csv(DATA / "otc_profile_contracts_clean.csv", index=False)
    cc_clean.to_csv(DATA / "otc_profile_current_contract_clean.csv", index=False)
    sh_clean.to_csv(DATA / "otc_profile_season_history_clean.csv", index=False)

    # report
    print(f"current season: {cur}")
    print(f"synthesized {len(syn)} contract rows for {syn.player_url.nunique()} QBs with empty OTC history: "
          + ", ".join(f"{k}={v}" for k, v in syn.contract_type.value_counts().items()))
    changed = c[(c.row_source == "otc_profile") & (c.contract_type != c.otc_contract_type)]
    for _, r in changed.iterrows():
        print(f"  retyped {r.player} {r.team} {r.year_signed} {r.otc_contract_type} -> {r.contract_type} "
              f"({r.contract_type_source})")
    print("overrides:")
    for oid, msg in log:
        print(f"  {oid}: {msg}")
    print(f"void years: current_contract {int(cc_clean.is_void_year.sum())}, "
          f"season_history {int(sh_clean.is_void_year.sum())}; projected season-history rows "
          f"{int(sh_clean.is_projected.sum())}")
    bad = [m for _, m in log if m.startswith(("UNMATCHED", "SKIPPED"))]
    if bad:
        print(f"WARNING: {len(bad)} override(s) not applied", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
