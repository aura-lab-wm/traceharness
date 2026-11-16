#!/usr/bin/env python3
"""Console width check: every main view fills the window and nothing overflows it.

Starts the console locally (python -m traceharness on a free port, stopped when done), opens the main
views at one width per display class (see traceharness/frontend/src/rig/displayClasses.js) with headless
Playwright, and fails on:

  * page-level horizontal overflow (the document scrolls sideways);
  * side-by-side panes ([data-panes] groups; panes are the direct children, or the [data-pane] descendants)
    whose top or bottom edges differ by more than 2 px;
  * an empty band at the bottom of a side-by-side pane above both 160 px and 30% of the pane;
  * an empty gap INSIDE a side-by-side pane (between its top padding and the first content, or between two
    consecutive content rects: the signature of a last block pinned to the bottom) above both 160 px and 30% of the pane;
  * a [data-fill] box with an empty band right of / below its content above both 240 px and 25%
    (gated from the laptop class up, below it the cards are single-column).

The same measurement logic as the website's tools/width_gate.py. Text outside the viewport is reported per
view (not failed): the console clips its tables and code in scroll boxes on purpose.

    python3 scripts/console_width_check.py                  # all views, all widths
    python3 scripts/console_width_check.py --only home,ds   # some views
    python3 scripts/console_width_check.py --url http://127.0.0.1:8790   # an already running console
    python3 scripts/console_width_check.py --shots DIR --themes dark,light --shot-widths 390,1512,2560,3840

Exit 0 when every measurement passes, 1 otherwise. Needs: playwright (python) and a chromium it can launch.
"""
import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WIDTHS = (320, 390, 600, 820, 1180, 1366, 1512, 1920, 2560, 3840)
CLASS_STARTS = (("small-phone", 0), ("phone", 360), ("large-phone", 480), ("tablet", 768), ("tablet-wide", 1024),
                ("laptop", 1280), ("desktop", 1440), ("full-hd", 1920), ("qhd", 2560), ("ultrawide", 3440))
HEIGHT = 900
STATES = ("sidebar", "nav closed")
PANE_TOL = 2
EMPTY_PX, EMPTY_FRAC = 160, 0.30
FILL_PX, FILL_FRAC = 240, 0.25
FILL_FROM = 1280

# (name, hash after #/rig/). Runs and datasets are looked up live from the console's own data.
VIEWS = (
    ("datasets", "home"),
    ("dataset", "ds:{ds}"),
    ("dataset-condition", "ds:{ds}:{model}:{harness}"),
    ("analysis", "an:{ds}:family"),
    ("analysis-delta", "an:{ds}:delta"),
    ("analysis-judge", "an:{ds}:judge"),
    ("trajectories", "tasks:{ds}"),
    ("run", "run:{run}"),
    ("span", "span:{run}:2"),
    ("compare", "cmp:{run}:{run2}"),
    ("harnesses", "harnesses"),
    ("blocks", "blocks"),
    ("sources", "sources"),
    ("sentinel", "sentinel"),
    ("settings", "settings"),
    ("split", "home|ds:{ds}"),
    ("dock", "home?dock=log"),
    ("dock-buddy", "ds:{ds}?dock=buddy"),
)

MEASURE_JS = r"""() => {
  // The site header, footer and their links are chrome; an in-page section rail (e.g. the admin nav) is layout and counts.
  const skip = el => el.closest('header, footer, .top, .foot, .rg-tb, .rg-sb, [role=banner], [role=contentinfo]');
  const W = document.documentElement.clientWidth;
  const clip = (r, el) => {
    let l = r.left, rt = r.right;
    for (let a = el; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = a.getBoundingClientRect();
      l = Math.max(l, b.left); rt = Math.min(rt, b.right);
    }
    return rt - l > 0.5 ? [l, rt] : null;
  };
  let l = Infinity, r = -Infinity, n = 0; const outside = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode; if (!t.textContent.trim()) continue;
    const el = t.parentElement; if (!el || skip(el)) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const range = document.createRange(); range.selectNodeContents(t);
    for (const b of range.getClientRects()) {
      if (b.width < 1 || b.bottom < 0 || b.top > innerHeight * 4) continue;
      const v = clip(b, el); if (!v) continue;
      l = Math.min(l, v[0]); r = Math.max(r, v[1]); n++;
      if (v[0] < -1 || v[1] > W + 1) {
        if (outside.length < 4) outside.push((el.className ? el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] : el.tagName.toLowerCase()) + ' "' + t.textContent.trim().slice(0, 24) + '" ' + Math.round(v[0]) + '..' + Math.round(v[1]));
      }
    }
  }
  const de = document.documentElement;
  return {l: Math.round(l), r: Math.round(r), used: n ? Math.round((r - l) / W * 100) : null, n,
          overflow: Math.max(0, de.scrollWidth - W, document.body.scrollWidth - W), outside,
          title: document.title.slice(0, 40), h1: (document.querySelector('h1') || {}).textContent || ''};
}"""

PANES_JS = r"""() => {
  const shown = e => { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') return false; const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const kids = e => { let out = []; for (const c of e.children) { const cs = getComputedStyle(c); if (cs.display === 'contents') out = out.concat(kids(c)); else if (!/^(SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName) && shown(c)) out.push(c); } return out; };
  const label = e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/)[0] : ''));
  // Lowest visible content in a pane: text, controls, media, tables, and a scroll box as its visible rect.
  const content = pane => {
    const pr = pane.getBoundingClientRect(); let low = pr.top; const rects = [];
    const take = (b, el) => { for (let a = el; a && a !== pane.parentElement; a = a.parentElement) { const cs = getComputedStyle(a); if (a !== pane && (cs.overflowY !== 'visible' || cs.overflowX !== 'visible')) { const ab = a.getBoundingClientRect(); b = {bottom: Math.min(b.bottom, ab.bottom), top: Math.max(b.top, ab.top), height: Math.min(b.bottom, ab.bottom) - Math.max(b.top, ab.top)}; } } if (b.height > 0.5) rects.push([b.top + scrollY, b.bottom + scrollY]); if (b.height > 0.5 && b.bottom > low) low = b.bottom; };
    const vis = e => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
    const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) { const t = walker.currentNode; const el = t.parentElement; if (!t.textContent.trim() || !el || !vis(el)) continue; const range = document.createRange(); range.selectNodeContents(t); for (const b of range.getClientRects()) if (b.width > 0.5) take(b, el); }
    for (const e of pane.querySelectorAll('img,svg,canvas,video,input,select,textarea,button,table,hr,progress,iframe')) { if (!vis(e) || (e.parentElement && e.parentElement.closest('svg'))) continue; const b = e.getBoundingClientRect(); if (b.width > 1 && b.height > 1) take(b, e); }
    for (const e of pane.querySelectorAll('*')) { const cs = getComputedStyle(e); if (e !== pane && vis(e) && (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && e.scrollHeight > 0) { const b = e.getBoundingClientRect(); if (b.width > 1 && b.height > 1 && e.textContent.trim()) take(b, e); } }
    return {low, rects};
  };
  const groups = [];
  for (const g of document.querySelectorAll('[data-panes]')) {
    if (!shown(g)) continue;
    const marked = [...g.querySelectorAll('[data-pane]')].filter(shown);
    const panes = (marked.length ? marked : kids(g)).map(e => { const r = e.getBoundingClientRect(); const c = content(e); return {n: label(e), t: r.top + scrollY, b: r.bottom + scrollY, l: r.left, r: r.right, ce: c.low + scrollY, rects: c.rects, ct: r.top + scrollY + (parseFloat(getComputedStyle(e).paddingTop) || 0), pb: r.bottom + scrollY - (parseFloat(getComputedStyle(e).paddingBottom) || 0)}; });
    groups.push({name: label(g), panes});
  }
  // A docked detail panel is a grid column of its row, never a full-height fixed pane beside normal-flow content.
  for (const d of document.querySelectorAll('[data-dock]')) if (getComputedStyle(d).position === 'fixed' && d.getClientRects().length) groups.push({name: label(d), fixed: true, panes: []});
  return groups;
}"""

FILL_JS = r"""() => {
  const vis = e => { for (let a = e; a && a !== document.documentElement; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false; } return true; };
  const label = e => (e.id ? '#' + e.id : (e.getAttribute('aria-labelledby') ? '[' + e.getAttribute('aria-labelledby') + ']' : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/)[0] : '')));
  const out = [];
  for (const el of document.querySelectorAll('[data-fill]')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el), px = v => parseFloat(v) || 0;
    const box = {l: r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft), r: r.right - px(cs.borderRightWidth) - px(cs.paddingRight),
                 t: r.top + scrollY + px(cs.borderTopWidth) + px(cs.paddingTop), b: r.bottom + scrollY - px(cs.borderBottomWidth) - px(cs.paddingBottom)};
    const rects = [];
    const add = b => { if (b.width < 1 || b.height < 1) return; rects.push([b.left, b.right, b.top + scrollY, b.bottom + scrollY]); };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) { const t = walker.currentNode; if (!t.textContent.trim() || !t.parentElement || !vis(t.parentElement)) continue; const range = document.createRange(); range.selectNodeContents(t); for (const b of range.getClientRects()) add(b); }
    for (const e of el.querySelectorAll('img,svg,canvas,video,input,select,textarea,button,table,hr,progress,iframe')) { if (!vis(e) || (e.parentElement && e.parentElement.closest('svg'))) continue; add(e.getBoundingClientRect()); }
    out.push({n: label(el), l: box.l, r: box.r, t: box.t, b: box.b, rects});
  }
  return out;
}"""


def class_of(width):
    name = CLASS_STARTS[0][0]
    for label, start in CLASS_STARTS:
        if width >= start:
            name = label
    return name


def _row_components(panes):
    """Rows of side-by-side panes: panes that do not overlap horizontally but share a vertical stretch."""
    n = len(panes)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(n):
        for j in range(i + 1, n):
            a, b = panes[i], panes[j]
            apart = a["l"] >= b["r"] - 1 or b["l"] >= a["r"] - 1
            shared = min(a["b"], b["b"]) - max(a["t"], b["t"])
            if apart and shared > PANE_TOL:
                parent[find(i)] = find(j)
    rows = {}
    for i in range(n):
        rows.setdefault(find(i), []).append(panes[i])
    return [r for r in rows.values() if len(r) > 1]


def internal_gap(p):
    """Largest vertical gap between consecutive content rects of a pane (and from its top padding to the first
    content): (gap px, page y where it starts). Content = text, controls, media, tables, scroll boxes."""
    rects = sorted(p.get("rects") or [])
    if not rects:
        return 0.0, p["t"]
    best, at = rects[0][0] - p["ct"], p["ct"]
    reach = rects[0][1]
    for top, bottom in rects[1:]:
        if top - reach > best:
            best, at = top - reach, reach
        reach = max(reach, bottom)
    return max(best, 0.0), at


def pane_report(groups):
    checked, bad = 0, []
    for g in groups or []:
        if g.get("fixed"):
            bad.append(f"docked pane {g['name']} is position:fixed instead of a grid column beside its card")
            continue
        for row in _row_components(g["panes"]):
            checked += 1
            top = max(p["t"] for p in row) - min(p["t"] for p in row)
            bottom = max(p["b"] for p in row) - min(p["b"] for p in row)
            if top > PANE_TOL or bottom > PANE_TOL:
                names = ", ".join(f"{p['n']} {p['t']:.0f}..{p['b']:.0f}" for p in row)
                bad.append(f"panes of {g['name']} not aligned (tops differ {top:.0f}px, bottoms differ {bottom:.0f}px): {names}")
            for p in row:
                empty = p["pb"] - p["ce"]
                if empty > EMPTY_PX and empty > EMPTY_FRAC * (p["b"] - p["t"]):
                    bad.append(f"pane {p['n']} of {g['name']} is {empty:.0f}px empty at the bottom "
                               f"({empty / (p['b'] - p['t']) * 100:.0f}% of its {p['b'] - p['t']:.0f}px height)")
                gap, at = internal_gap(p)
                height = p["b"] - p["t"]
                if gap > EMPTY_PX and gap > EMPTY_FRAC * height:
                    bad.append(f"pane {p['n']} of {g['name']} has a {gap:.0f}px empty gap inside it at y={at:.0f} "
                               f"({gap / height * 100:.0f}% of its {height:.0f}px height)")
    return {"checked": checked, "bad": bad}


def fill_report(items):
    bad = []
    for it in items or []:
        w, h = it["r"] - it["l"], it["b"] - it["t"]
        rects = it.get("rects") or []
        if not rects:
            bad.append(f"{it['n']} has no visible content")
            continue
        for label, part in (("", rects), (" in its top half", [r for r in rects if r[2] < it["t"] + h / 2]),
                            (" in its bottom half", [r for r in rects if r[3] > it["t"] + h / 2])):
            if not part:
                continue
            right = it["r"] - max(r[1] for r in part)
            if right > FILL_PX and right > FILL_FRAC * w:
                bad.append(f"{it['n']} is {right:.0f}px empty to the right of its content{label} ({right / w * 100:.0f}% of its {w:.0f}px width)")
        below = it["b"] - max(r[3] for r in rects)
        if below > FILL_PX and below > FILL_FRAC * h:
            bad.append(f"{it['n']} is {below:.0f}px empty below its content ({below / h * 100:.0f}% of its {h:.0f}px height)")
    return {"checked": len(items or []), "bad": bad}


def evaluate(width, m):
    out = list(m["panes"]["bad"])
    if width >= FILL_FROM:
        out += m["fill"]["bad"]
    if m["overflow"] > 0:
        out.append(f"page scrolls sideways by {m['overflow']}px")
    return out


def free_port():
    for port in range(8790, 8800):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit("no free port in 8790-8799")


def get_json(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def pick_data(base):
    """A dataset with runs, one of its conditions, a run and a task, from the console's own API."""
    results = get_json(base + "/api/results")
    # a real dataset of moderate size: the biggest ones (thousands of runs) only make the measurement slow
    ds = max((r for r in results if 100 <= r["runs"] <= 700 and len(r["models"]) > 1), key=lambda r: r["runs"],
             default=max(results, key=lambda r: r["runs"]))
    name = ds["name"]
    runs = get_json(f"{base}/api/results/{name}/runs")
    run = runs[0]
    return {"ds": name, "model": run["model"].replace(":", "%3A"), "harness": run["harness_id"],
            "run": run["run_id"], "run2": runs[1]["run_id"], "task": run["task_id"]}


def measure_once(page):
    m = page.evaluate(MEASURE_JS)
    m["panes"] = pane_report(page.evaluate(PANES_JS))
    m["fill"] = fill_report(page.evaluate(FILL_JS))
    return m


def measure(page, base, spec, width, settle=900):
    page.set_viewport_size({"width": width, "height": HEIGHT})
    page.goto(f"{base}/#/rig/{spec}", wait_until="load", timeout=60000)
    page.wait_for_timeout(settle)
    m = measure_once(page)
    if evaluate(width, m):
        # a failure is measured again after the view has had longer to settle (data arriving, fonts, charts)
        page.wait_for_timeout(2000)
        m = measure_once(page)
    return m


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="use this running console instead of starting one")
    ap.add_argument("--only", help="comma-separated view names")
    ap.add_argument("--widths", help="comma-separated widths (default: one per class)")
    ap.add_argument("--report", help="write the JSON report here")
    ap.add_argument("--shots", help="directory: also save screenshots (see --themes, --shot-widths)")
    ap.add_argument("--themes", default="dark", help="themes to screenshot (dark,light)")
    ap.add_argument("--shot-widths", default="390,1512,2560,3840")
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright

    proc = None
    base = args.url
    if not base:
        port = free_port()
        base = f"http://127.0.0.1:{port}"
        proc = subprocess.Popen([sys.executable, "-m", "traceharness", "--host", "127.0.0.1", "--port", str(port), "--no-browser"],
                                cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try:
                get_json(base + "/api/results")
                break
            except Exception:
                time.sleep(0.5)
        else:
            proc.terminate()
            raise SystemExit("console did not start")
    results, failures = {}, []
    try:
        data = pick_data(base)
        widths = tuple(int(w) for w in args.widths.split(",")) if args.widths else WIDTHS
        shot_widths = {int(w) for w in args.shot_widths.split(",")}
        views = [v for v in VIEWS if not args.only or v[0] in args.only.split(",")]
        with sync_playwright() as p:
            exe = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
            browser = p.chromium.launch(headless=True, **({"executable_path": exe} if exe else {}))
            # One fresh page per width and sidebar state (the console decides whether its sidebar starts open from
            # the width at load, and keeps it): the left sidebar open (default) and folded away (rig.nav = closed).
            for state in STATES:
                for width in widths:
                    context = browser.new_context(viewport={"width": width, "height": HEIGHT})
                    if state == "nav closed":
                        context.add_init_script("try { localStorage.setItem('rig.nav', 'closed') } catch (e) {}")
                    page = context.new_page()
                    page.goto(base + "/", wait_until="load")
                    for name, tmpl in views:
                        spec = tmpl.format(**data)
                        m = measure(page, base, spec, width)
                        key = name if state == "sidebar" else f"{name} ({state})"
                        bad = evaluate(width, m)
                        m["failures"] = bad
                        results[f"{key}@{width}"] = m
                        print(f"  {key}@{width}: {len(bad)} failure(s)", file=sys.stderr, flush=True)
                        if bad:
                            failures.append({"view": key, "width": width, "class": class_of(width), "why": bad})
                        if args.shots and state == "sidebar" and width in shot_widths:
                            Path(args.shots).mkdir(parents=True, exist_ok=True)
                            for theme in args.themes.split(","):
                                t2 = spec + ("&" if "?" in spec else "?") + f"theme={theme}"
                                page.goto(f"{base}/#/rig/{t2}")
                                page.wait_for_timeout(1200)
                                page.screenshot(path=str(Path(args.shots) / f"{name}_{theme}_{width}.png"))
                    context.close()
            browser.close()
    finally:
        if proc:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()

    # The table: per view and width, the share of the viewport used by text; "!" a failure; "*" text beyond the viewport.
    wcols = sorted({int(k.split("@")[1]) for k in results})
    print(f"{'view':<30}" + "".join(f"{w:>7}" for w in wcols))
    print(f"{'class':<30}" + "".join(f"{class_of(w)[:6]:>7}" for w in wcols))
    names = []
    for state in STATES:
        names += [n if state == "sidebar" else f"{n} ({state})" for n, _ in VIEWS if not args.only or n in args.only.split(",")]
    for name in names:
        row = ""
        for w in wcols:
            m = results[f"{name}@{w}"]
            cell = "-" if m["used"] is None else f"{m['used']}"
            cell += "!" if m["failures"] else ""
            cell += "*" if m["outside"] else ""
            row += f"{cell:>7}"
        print(f"{name:<30}{row}")
    checked = sum(m["panes"]["checked"] for m in results.values())
    filled = sum(m["fill"]["checked"] for m in results.values())
    print(f"\n(text share of viewport, %; ! fails; * text clipped in a scroll box beyond the viewport)")
    print(f"{len(results)} measurements, {checked} side-by-side rows checked, {filled} [data-fill] boxes checked")
    if args.report:
        Path(args.report).write_text(json.dumps(results, indent=1))
    if failures:
        print(f"\nFAIL: {len(failures)} measurement(s)")
        for f in failures:
            print(f"  {f['view']} @ {f['width']} ({f['class']})")
            for w in f["why"]:
                print(f"      - {w}")
        return 1
    print("\nPASS: no overflow, aligned panes, no empty bands")
    return 0


if __name__ == "__main__":
    sys.exit(main())
