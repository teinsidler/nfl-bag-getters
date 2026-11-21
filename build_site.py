"""Assemble the static website in _site/ (what GitHub Pages serves).

Copies site/ (page, styles, scripts, vendored d3) and the dashboard JSON from
data/dashboard/ into _site/data/. Script and style URLs get a ?v=<hash of the file>
suffix so browsers pick up new versions after each deploy.

    python build_site.py            # then: python -m http.server -d _site 8000
"""
import hashlib
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
SRC, DATA, OUT = ROOT / "site", ROOT / "data" / "dashboard", ROOT / "_site"
DATASETS = ["meta", "seasons", "dead_money", "contracts", "players", "team_seasons", "game_log"]


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(SRC, OUT)
    (OUT / "data").mkdir()
    for name in DATASETS:
        shutil.copy2(DATA / f"{name}.json", OUT / "data" / f"{name}.json")

    page = OUT / "index.html"
    html = page.read_text()

    def bust(m: re.Match) -> str:
        path = m.group(2)
        digest = hashlib.sha256((OUT / path).read_bytes()).hexdigest()[:10]
        return f'{m.group(1)}="{path}?v={digest}"'

    html = re.sub(r'\b(src|href)="((?:css|js|vendor)/[^"?]+)"', bust, html)
    page.write_text(html)
    (OUT / ".nojekyll").write_text("")  # serve files as-is
    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"Built {OUT} ({size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
