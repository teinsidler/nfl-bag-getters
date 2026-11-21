"""Export the dashboard as one self-contained HTML file (no claude.ai, no network needed).

Builds on the local harness (harness/build.py): its stand-in for the dashboard framework,
plus d3 and every data file inlined into the page. Output: dashboard/qb_bag_getters.html
"""
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE.parent / "data" / "dashboard"
OUT = HERE / "qb_bag_getters.html"
D3_URL = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"
D3_TAG = f'<script src="{D3_URL}"></script>'
FETCH = ("Promise.all(['seasons','dead_money','contracts','players','team_seasons'].map(n=>fetch("
         "'../../data/dashboard/'+n+'.json').then(r=>r.json()).then(j=>DASH_DATA[n]=j.rows))).then(()=>{run();});")
DARK = """<style>
@media (prefers-color-scheme: dark){:root{--color-fg:#ecebe6;--color-fg-muted:#a3a19a;--color-bg:#1b1b19;--color-panel:#262624;--color-border-line:#3a3936;--c0:#8fb0e6}}
</style>"""


def main() -> None:
    subprocess.run([sys.executable, str(HERE / "harness" / "build.py")], check=True)
    html = (HERE / "harness" / "index.html").read_text()
    assert html.count(D3_TAG) == 1 and html.count(FETCH) == 1, "harness changed; update this script"

    d3 = urllib.request.urlopen(D3_URL, timeout=60).read().decode()
    data = {n: json.loads((DATA / f"{n}.json").read_text())["rows"]
            for n in ("seasons", "dead_money", "contracts", "players", "team_seasons")}
    # keep "</script>" inside the JSON from closing the tag
    blob = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")

    html = html.replace(D3_TAG, f"<script>{d3}</script>")
    html = html.replace(FETCH, f"Object.assign(DASH_DATA,{blob});run();")
    page = ("<!doctype html>\n<html lang=\"en\"><head><title>QB Bag Getters</title>\n"
            + DARK + "</head><body>\n" + html + "\n</body></html>\n")
    OUT.write_text(page)
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
