"""Smoke test for the built site (_site/), served under /nfl-bag-getters/ like GitHub Pages.

    python build_site.py && pytest tests/test_site_smoke.py

The runtime catches errors thrown while drawing and records them in window.__errors
instead of the console, so every check reads that list as well as page errors.
"""
import functools
import http.server
import tempfile
import threading
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

SITE = Path(__file__).resolve().parents[1] / "_site"
SUBPATH = "nfl-bag-getters"


@pytest.fixture(scope="module")
def base_url():
    if not (SITE / "index.html").exists():
        pytest.fail("_site/ is missing; run `python build_site.py` first")
    with tempfile.TemporaryDirectory() as root:
        (Path(root) / SUBPATH).symlink_to(SITE, target_is_directory=True)
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
        handler.log_message = lambda *a: None
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        yield f"http://127.0.0.1:{server.server_port}/{SUBPATH}/"
        server.shutdown()


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


CSP_WATCH = """window.__csp = [];
document.addEventListener('securitypolicyviolation',
  e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));"""


@pytest.fixture(scope="module")
def page(base_url, browser):
    pg = browser.new_page(viewport={"width": 1200, "height": 900})
    pg.problems = []
    pg.on("pageerror", lambda e: pg.problems.append(f"pageerror: {e}"))
    pg.on("console", lambda m: m.type == "error" and pg.problems.append(f"console: {m.text}"))
    pg.on("requestfailed", lambda r: pg.problems.append(f"request failed: {r.url}"))
    outside = []
    pg.on("request", lambda r: None if r.url.startswith(base_url) else outside.append(r.url))
    pg.outside = outside
    pg.add_init_script(CSP_WATCH)
    pg.goto(base_url)
    # locator waits, not wait_for_function: polling a JS string needs eval, which the page's CSP blocks
    pg.locator('[data-draw="lede"]', has_text="biggest bag").wait_for(timeout=20000)
    yield pg
    pg.close()


def assert_clean(page):
    errors = page.evaluate("window.__errors")
    assert errors == [], errors
    assert page.problems == [], page.problems
    assert page.evaluate("window.__csp") == [], "Content-Security-Policy violations"


def test_quarterbacks_view(page):
    assert_clean(page)
    assert page.locator('[data-draw="board"] tr').count() >= 10
    assert page.locator('[data-draw="scatter"] circle').count() > 50
    years = page.locator("#to option").count()
    assert years >= 27, "season options come from data/meta.json"
    assert page.locator('[data-draw="fresh"]').inner_text().startswith("Data through"), "freshness label"
    assert page.outside == [], f"requests outside the site: {page.outside}"


def test_quarterback_page(page):
    page.locator('[data-draw="board"] tr').first.click()
    page.locator("#qb").wait_for(state="visible")
    assert page.locator('[data-draw="qb-name"]').inner_text().strip() not in ("", "—")
    assert page.locator('[data-draw="qb-seasons"] tr').count() >= 1
    assert_clean(page)


def test_teams_view(page):
    page.locator('[data-view="teams"]').click()
    page.locator('[data-draw="sankey"] rect').nth(5).wait_for()
    assert "where the quarterback money went" in page.locator('[data-draw="team-title"]').inner_text()
    assert page.locator('[data-draw="team-table"] tr').count() >= 1
    assert_clean(page)


def test_phone_width(base_url, browser):
    pg = browser.new_page(viewport={"width": 375, "height": 812})
    pg.goto(base_url)
    pg.locator('[data-draw="board"] tr').first.wait_for(timeout=20000)
    overflow = pg.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    errors = pg.evaluate("window.__errors")
    pg.close()
    assert overflow <= 0, f"page scrolls sideways by {overflow}px at phone width"
    assert errors == [], errors
