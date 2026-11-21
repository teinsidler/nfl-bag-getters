"""Scrape every quarterback's Over The Cap profile page for their contract data.

Reads data/qb_players.csv (from fetch_qb_contracts.py) and visits each player_url.
Raw HTML is cached in data/otc_profiles_html/ so reruns don't refetch; pass --refresh
to download again.

Outputs (all keyed by player + player_url):
  data/otc_profile_players.csv           one row per QB: entry (draft/UDFA), career earnings,
                                         bio, current-contract summary and notes
  data/otc_profile_contracts.csv         contract history: one row per contract per team,
                                         with contract type (Drafted, UDFA, Extension, ...)
                                         and status (Traded, Expired, ...)
  data/otc_profile_season_history.csv    year-by-year cap number, cash paid and salary parts
  data/otc_profile_earnings_by_team.csv  career earnings with each team
  data/otc_profile_dead_money.csv        dead money charges by team and year
  data/otc_profile_current_contract.csv  year-by-year breakdown of the current deal (active QBs)
"""
import re
import sys
import time
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup

DATA = Path(__file__).parent / "data"
CACHE = DATA / "otc_profiles_html"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
DELAY_SECONDS = 1.0
ROOKIE_TYPES = {"Drafted", "UDFA"}

TEXT_COLS = {"team", "contract_type", "status", "year", "age", "contract_trigger"}


def snake(text: str) -> str:
    text = " ".join(text.split()).lower().replace("%", "pct")
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


def to_number(val):
    """'$1,010,000' -> 1010000.0, '8.6%' -> 8.6, '--'/'' -> None."""
    if val is None:
        return None
    s = val.replace("📝", "").replace("$", "").replace(",", "").replace("%", "").strip()
    if s.startswith("(") and s.endswith(")"):  # accounting negative, e.g. ($15,882) = cap credit
        s = "-" + s[1:-1]
    if s in ("", "--", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return val


def parse_table(table) -> pd.DataFrame:
    """Parse an OTC table, dropping spacer and interactive (dead money / cap savings) columns."""
    body_rows = table.find("tbody").find_all("tr", recursive=False)
    head_rows = table.find("thead").find_all("tr")
    # Expand colspans. A second header row holds sub-labels for the first spanned group
    # (current contract: "Prorated Bonus" -> Signing / Option).
    subs = [" ".join(th.get_text(" ", strip=True).split()) for th in head_rows[1].find_all("th")] if len(head_rows) > 1 else []
    headers = []
    for th in head_rows[0].find_all("th", recursive=False):
        label = " ".join(th.get_text(" ", strip=True).split())
        span = int(th.get("colspan", 1))
        if span > 1 and len(subs) >= span and not label.startswith("Dead Money &"):
            headers += [f"{label} {subs.pop(0)}" for _ in range(span)]
        else:
            headers += [label] * span
    keep = [i for i, h in enumerate(headers) if h and not h.startswith("Dead Money &")]
    rows = []
    for tr in body_rows:
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td", recursive=False)]
        if len(cells) != len(headers):
            continue
        rows.append([cells[i] for i in keep])
    df = pd.DataFrame(rows, columns=[snake(headers[i]) for i in keep])
    if "year" in df:  # "2025 📝 March 22" -> year 2025, trigger "March 22"
        parts = df["year"].str.extract(r"^(\S+)\s*(?:📝\s*(.*))?$")
        df["year"] = parts[0]
        if parts[1].notna().any():
            df.insert(1, "contract_trigger", parts[1])
    for col in df.columns:
        if col not in TEXT_COLS:
            df[col] = df[col].map(to_number)
    return df


def table_under_heading(soup, heading: str):
    h = soup.find(lambda t: t.name in ("h3", "h4", "h5") and t.get_text(strip=True) == heading)
    return h.find_next("table") if h else None


def parse_entry(text):
    """'2010 Draft, Round 1, #1 overall (Rams)' / '1994 Undrafted Free Agent (Packers)'."""
    out = {"entry": text, "entry_year": None, "entry_type": None,
           "entry_round": None, "entry_pick": None, "entry_team": None}
    if not text:
        return out
    m = re.match(r"(\d{4})\s+(.*?)\s*(?:\(([^)]*)\))?\s*$", text)
    if not m:
        return out
    out["entry_year"], rest = int(m.group(1)), m.group(2)
    out["entry_team"] = m.group(3).strip() if m.group(3) else None
    if "Undrafted" in rest:
        out["entry_type"] = "Undrafted"
    elif "Supplemental" in rest:
        out["entry_type"] = "Supplemental Draft"
    elif "Draft" in rest:
        out["entry_type"] = "Draft"
    else:
        out["entry_type"] = rest.strip(", ")
    if r := re.search(r"Round (\d+)", rest):
        out["entry_round"] = int(r.group(1))
    if p := re.search(r"#(\d+)", rest):
        out["entry_pick"] = int(p.group(1))
    return out


def parse_profile(html: str) -> dict:
    soup = BeautifulSoup(html, "lxml")
    info = {}
    for h5 in soup.find_all("h5"):
        txt = h5.get_text(" ", strip=True)
        if ":" in txt:
            k, v = txt.split(":", 1)
            info[snake(k)] = v.strip()
    # bio + entry (active: ul.league-entry-info, retired: ul.player-bio), career totals, current deal
    for li in soup.select("ul.league-entry-info li, ul.player-bio li, span.career-history strong, ul.contract-info li"):
        txt = li.get_text(" ", strip=True)
        if ":" in txt:
            k, v = txt.split(":", 1)
            info.setdefault(snake(k), v.strip())
    for k in ("career_earnings", "career_apy", "total_guarantees", "weight"):
        if k in info:
            info[k] = to_number(info[k])
    info.update(parse_entry(info.pop("entry", None)))

    notes = soup.find(lambda t: t.name == "h4" and t.get_text(strip=True) == "Contract Notes")
    info["contract_notes"] = notes.find_next("p").get_text(" ", strip=True) if notes else None
    cur = soup.find(lambda t: t.name in ("h3", "h4") and t.get_text(strip=True) == "Current Contract")
    if cur:
        label = cur.find_next(string=re.compile(r"signed \d{4}"))
        info["current_contract"] = label.strip().strip("()") if label else None

    tables = {}
    for name, heading in [("contracts", "Contract History"), ("earnings_by_team", "Earnings By Team"),
                          ("season_history", "Season History"), ("dead_money", "Dead Money History")]:
        t = table_under_heading(soup, heading)
        tables[name] = parse_table(t) if t is not None else pd.DataFrame()
    cc = soup.select_one("table.current-contract")
    tables["current_contract"] = parse_table(cc) if cc is not None else pd.DataFrame()
    return {"info": info, "tables": tables}


def fetch(url: str, path: Path, refresh: bool, session: requests.Session) -> str:
    if path.exists() and not refresh:
        return path.read_text()
    for attempt in range(3):
        try:
            r = session.get(url, headers=HEADERS, timeout=30)
            r.raise_for_status()
            path.write_text(r.text)
            time.sleep(DELAY_SECONDS)
            return r.text
        except requests.RequestException as e:
            wait = 5 * (attempt + 1)
            print(f"  retry {attempt + 1} for {url} in {wait}s ({e})")
            time.sleep(wait)
    raise RuntimeError(f"failed to fetch {url}")


def main(refresh: bool = False) -> None:
    players = pd.read_csv(DATA / "qb_players.csv")[["player", "player_url"]]
    CACHE.mkdir(parents=True, exist_ok=True)
    session = requests.Session()

    info_rows, collected, failed = [], {}, []
    for i, (name, url) in enumerate(players.itertuples(index=False), 1):
        slug = "_".join(url.rstrip("/").split("/")[-2:])
        try:
            parsed = parse_profile(fetch(url, CACHE / f"{slug}.html", refresh, session))
        except Exception as e:
            print(f"[{i}/{len(players)}] {name}: FAILED ({e})")
            failed.append(name)
            continue
        info_rows.append({"player": name, "player_url": url, **parsed["info"]})
        for key, df in parsed["tables"].items():
            if len(df):
                df.insert(0, "player_url", url)
                df.insert(0, "player", name)
                collected.setdefault(key, []).append(df)
        if i % 25 == 0:
            print(f"[{i}/{len(players)}] processed")

    pd.DataFrame(info_rows).to_csv(DATA / "otc_profile_players.csv", index=False)

    contracts = pd.concat(collected["contracts"], ignore_index=True)
    contracts["year_signed"] = contracts["year_signed"].astype("Int64")
    contracts["yrs"] = contracts["yrs"].astype("Int64")
    contracts["is_rookie_contract"] = contracts["contract_type"].isin(ROOKIE_TYPES)
    contracts.to_csv(DATA / "otc_profile_contracts.csv", index=False)

    season = pd.concat(collected["season_history"], ignore_index=True)
    season = season[season["year"].str.fullmatch(r"\d{4}", na=False)]  # drop Total rows
    season.to_csv(DATA / "otc_profile_season_history.csv", index=False)

    for key in ("earnings_by_team", "dead_money", "current_contract"):
        df = pd.concat(collected.get(key, [pd.DataFrame()]), ignore_index=True)
        if "prorated_signing_bonus" in df and "prorated_bonus_signing" in df:  # two OTC header layouts
            df["prorated_bonus_signing"] = df["prorated_bonus_signing"].fillna(df.pop("prorated_signing_bonus"))
        if "year" in df:
            df = df[df["year"].astype(str).str.fullmatch(r"\d{4}", na=False)]
        df.to_csv(DATA / f"otc_profile_{key}.csv", index=False)

    print(f"\nParsed {len(info_rows)}/{len(players)} profiles; {len(contracts)} contract rows "
          f"({contracts.is_rookie_contract.sum()} rookie: Drafted/UDFA)")
    print("Contract types:", contracts["contract_type"].value_counts().to_dict())
    if failed:
        print("Failed:", ", ".join(failed))


if __name__ == "__main__":
    main(refresh="--refresh" in sys.argv)
