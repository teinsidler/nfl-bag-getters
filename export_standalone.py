"""Export the site as one self-contained HTML file that opens offline in any browser.

Builds _site/ first (build_site.py), then inlines its styles, scripts and data.
Output: qb_bag_getters.html (about 4.6 MB; anyone with the file can read all the data).

    python export_standalone.py [output.html]
"""
import json
import re
import sys
from pathlib import Path

import build_site

ROOT = Path(__file__).parent
SITE = ROOT / "_site"


def main(out: Path) -> None:
    build_site.main()
    html = (SITE / "index.html").read_text()

    def asset(path: str) -> str:
        return (SITE / path.split("?")[0]).read_text()

    def safe_js(js: str) -> str:
        return js.replace("</script", "<\\/script")

    html, n_css = re.subn(r'<link rel="stylesheet" href="([^"]+)">',
                          lambda m: f"<style>\n{asset(m.group(1))}</style>", html)
    # deferred scripts run after the page is parsed, in order: inline them at the end of <body> to match
    scripts = re.findall(r'<script defer src="([^"]+)"></script>\n?', html)
    html = re.sub(r'<script defer src="[^"]+"></script>\n?', "", html)
    n_js = len(scripts)
    data = {n: json.loads((SITE / "data" / f"{n}.json").read_text())["rows"] for n in build_site.DATASETS}
    blob = safe_js(json.dumps(data, separators=(",", ":")))
    body = f"<script>window.DASH_INLINE={blob};</script>\n"
    body += "".join(f"<script>\n{safe_js(asset(src))}\n</script>\n" for src in scripts)
    html = html.replace("</body>", body + "</body>", 1)
    assert n_css == 2 and n_js == 6, (n_css, n_js)
    out.write_text(html)
    print(f"Wrote {out} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "qb_bag_getters.html")
