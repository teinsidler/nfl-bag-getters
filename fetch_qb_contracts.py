"""Scrape the Over The Cap quarterback contract history table to CSV.

Outputs:
  data/qb_contracts.csv  - one row per contract (rows with Year Signed == 0 removed)
  data/qb_players.csv    - one row per quarterback: name and Over The Cap player URL
"""
from io import StringIO
from pathlib import Path
from urllib.parse import urljoin

import pandas as pd
import requests

URL = "https://overthecap.com/contract-history/quarterback"
BASE = "https://overthecap.com"
OUT_DIR = Path(__file__).parent / "data"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

MONEY_COLS = ["value", "apy", "guaranteed", "inflated_value", "inflated_apy", "inflated_guaranteed"]


def clean_header(h: str) -> str:
    return " ".join(str(h).split()).lower().replace("%", "pct").replace(" ", "_")


def main() -> None:
    resp = requests.get(URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    html = resp.text

    # extract_links="body" turns each body cell into a (text, href) tuple
    raw = pd.read_html(StringIO(html), extract_links="body")[0]
    raw = raw.loc[:, [not str(c).startswith("Unnamed") for c in raw.columns]]  # drop spacer columns
    raw.columns = [clean_header(c) for c in raw.columns]
    # -> player, team, year_signed, years, value, apy, guaranteed, apy_as_pct_of_cap_at_signing, inflated_*

    expected_rows = html.count("<tr") - 1  # minus the header row
    assert len(raw) == expected_rows, f"parsed {len(raw)} rows, html has {expected_rows}"

    df = raw.apply(lambda col: col.map(lambda cell: cell[0]))
    df["player_url"] = raw["player"].map(lambda cell: urljoin(BASE, cell[1]) if cell[1] else None)

    df["year_signed"] = pd.to_numeric(df["year_signed"], errors="coerce")
    df["years"] = pd.to_numeric(df["years"], errors="coerce")
    for col in MONEY_COLS:
        df[col] = pd.to_numeric(df[col].str.replace(r"[$,]", "", regex=True), errors="coerce")
    df["apy_pct_of_cap"] = pd.to_numeric(
        df.pop("apy_as_pct_of_cap_at_signing").str.rstrip("%"), errors="coerce"
    )

    before = len(df)
    df = df[df["year_signed"] != 0].copy()
    print(f"Parsed {before} contracts; removed {before - len(df)} with year signed = 0")

    df["year_signed"] = df["year_signed"].astype("Int64")
    df["years"] = df["years"].astype("Int64")

    OUT_DIR.mkdir(exist_ok=True)
    df.to_csv(OUT_DIR / "qb_contracts.csv", index=False)

    players = (
        df[["player", "player_url"]]
        .dropna(subset=["player_url"])
        .drop_duplicates(subset="player_url")
        .sort_values("player")
    )
    players.to_csv(OUT_DIR / "qb_players.csv", index=False)
    print(f"Wrote {len(df)} contracts and {len(players)} players to {OUT_DIR}")


if __name__ == "__main__":
    main()
