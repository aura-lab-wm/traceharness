"""One self-contained HTML file with the data baked in.

A running server is not a deliverable: a participant cannot hand one in, a reviewer cannot open
one six months later, and a supplementary link that needs `pip install` is a link most people
will not follow. This writes the built UI plus a snapshot of every read-only API response into a
single file that opens from disk with no server, no network and no dependencies.

    python -m traceharness --export me.html
    python -m traceharness --export me.html --export-results live
    python -m traceharness --export me.html --export-results live --export-runs 0   # skip run details
    python -m traceharness --export me.html --export-runs 2000 --export-compress-data

The snapshot is taken by calling the running app through Starlette's TestClient rather than by
calling the metrics functions directly, so what lands in the file is byte-for-byte what the
server would have answered — a hand-rolled second path is exactly how a static export starts
disagreeing with the live one.

Live actions (launching runs, training, importing) are absent by construction: there is nothing
to POST to. The frontend detects the embedded payload, serves reads from it, refuses writes, and
matches on the *normalised query string* so a request carrying parameters the snapshot lacks
fails loudly instead of quietly resolving to the wrong numbers.

A standalone export stays read-only. A host may explicitly insert an authenticated member
marker to enable its narrowly scoped harness compile/save bridge; this never enables execution.
"""
from __future__ import annotations
import base64, gzip, json, os, re, time
from urllib.parse import quote

from .paths import DIST, RUNS_ROOT
from .private_guard import OPT_IN_HEADER
from .results_scope import is_private, list_results_dirs

# How many per-run detail payloads to embed. Trajectories needs one per run it can open; all 576
# of a live directory would make the file unwieldy, so this is a bounded, stated sample.
DEFAULT_RUNS = 40

# These are limits on the snapshot, independent of any web host's HTML limit. Check both
# while exporting and while reading: a small gzip must not allocate unbounded decoded data.
MAX_DATA_BYTES = 256 * 1024 * 1024
MAX_COMPRESSED_DATA_BYTES = 64 * 1024 * 1024


#: Keys stripped from a payload before it is embedded. An export is handed to a participant or a
#: reviewer, so nothing in it may identify the machine that produced it. /api/settings answers with
#: `key_hint` -- seven leading and four trailing characters of the operator's OpenRouter key -- and
#: with four absolute paths that embed the username. The page keeps working offline: what a reader
#: legitimately needs (whether a key is configured, which dirs and harnesses exist) survives.
#: `/import/status` reports the path that was imported, expanded -- so after one import of a
#: session store it carries /Users/<name>/.claude/projects, both at the top level and again inside
#: `result`. A dotted name reaches one level down; the whole payload is frozen into the export, so
#: the nested copy leaks exactly as loudly as the outer one.
REDACT = {"/settings": ("key_hint", "lab_root", "results_root", "harness_dir", "task_dir", "base_url"),
          "/import/status": ("path", "result.path")}


def redact(path: str, payload):
    """`payload` without the keys REDACT names for `path`. Anything unlisted passes through.

    A name may be dotted (`result.path`) to drop a key from a nested object, which is left alone
    when it is absent or is not an object -- an idle import has `result: None`.
    """
    drop = REDACT.get(path)
    if not drop or not isinstance(payload, dict):
        return payload
    nested: dict[str, set] = {}
    for name in drop:
        if "." in name:
            outer, inner = name.split(".", 1)
            nested.setdefault(outer, set()).add(inner)
    out = {k: v for k, v in payload.items() if k not in drop}
    for outer, inners in nested.items():
        if isinstance(out.get(outer), dict):
            out[outer] = {k: v for k, v in out[outer].items() if k not in inners}
    return out


#: URLs that answer the same way regardless of which results directory is being exported --
#: fetched once by build(), outside the per-dir generation-pinning window (see "PIN ONE
#: GENERATION" there), since there is no study revision for them to ever disagree about.
_GLOBAL_URLS = ["/api/overview", "/api/tasks", "/api/harnesses", "/api/models",
                "/api/sentinel", "/api/sentinel/plugins", "/api/judge",
                "/api/harness/list", "/api/harness/knobs",
                "/api/import/sources", "/api/import/status", "/api/real/status",
                "/api/export/formats", "/api/settings",
                # The block builder fetches these with no static-export guard, so a
                # frozen page still needs the preset catalog and the blank palette.
                "/api/blocks/catalog", "/api/blocks/palette"]


def _dir_urls(client, d: str, n_runs: int) -> list[str]:
    """Every read-only URL ONE results dir's pages actually request.

    Split out of _urls() so build() can fetch one dir's whole set inside a single
    generation-pinned window: every URL here reads `d`'s index.jsonl (directly, or via a
    study-aggregate endpoint that reads it), so a comparisons response and an oracle response
    baked for the same `d` must come from one read of it, never two.
    """
    ov = client.get(f"/api/results/{d}/runs")
    rows = ov.json() if ov.status_code == 200 else []
    harnesses = sorted({r["harness_id"] for r in rows}) or ["baseline"]
    q = lambda v: quote(str(v), safe="")   # noqa: E731 - local shorthand
    out = [f"/api/results/{d}/runs", f"/api/results/{d}/metrics",
           f"/api/results/{d}/experiment", f"/api/real/{d}/analysis",
           f"/api/harness/versions?dir={d}", f"/api/harness/list?dir={d}",
           f"/api/fork/{d}/pairs?limit=80",
           f"/api/sentinel/leaderboard?dir={d}&k=10%2C15%2C20&threshold=0.6",
           f"/api/field/html?results={d}",
           # RepeatsChart (mounted in the trajectories tab, StepAttribute.jsx) fetches this
           # with no `harness` param first; the per-harness variants below cover the filtered
           # view the tab's own harness picker switches to.
           f"/api/repeats/{d}",
           # Failure modes per run (outcomes_api.py): the Rig workbench's failure chips and
           # its "how do runs fail?" answer read this; one bake per dir.
           f"/api/outcomes/{d}",
           # Judge and report's agreement summary (docs/superpowers/specs/2026-09-21-study-
           # aggregates-design.md): no parameters to vary, one bake per dir.
           f"/api/results/{d}/oracle",
           # The attribution matrix: every model's per-harness comparison in one response, at
           # its bare (server-picked) baseline HARNESS. Explicit default and real-harness
           # variants below also cover the matrix and its baseline picker offline.
           # The baseline is a HARNESS id -- the first version of
           # this baked one variant per MODEL, which matched an endpoint that wrongly compared
           # models against each other.
           f"/api/results/{d}/comparisons",
           # The frontend's historical default is explicit even when this dataset's
           # actual harness is named swe-agent or claude-code. The live API resolves it.
           f"/api/results/{d}/comparisons?baseline=baseline"]
    for h in harnesses:
        out.append(f"/api/results/{d}/comparisons?baseline={q(h)}")
    for h in harnesses:
        out += [f"/api/results/{d}/runs?harness={q(h)}",
                f"/api/results/{d}/metrics?baseline={q(h)}",
                f"/api/results/{d}/integrity?harness={q(h)}",
                f"/api/results/{d}/report?harness={q(h)}",
                f"/api/results/{d}/patterns?harness={q(h)}",
                f"/api/sentinel/replay_all/{d}?harness={q(h)}",
                # the Sentinel page's leaderboard, at the defaults its controls start on
                f"/api/sentinel/leaderboard?dir={d}&k=10%2C15%2C20&threshold=0.6&harness={q(h)}",
                f"/api/repeats/{d}?harness={q(h)}"]
        for model in sorted({r["model"] for r in rows if r["harness_id"] == h}):
            out.append(f"/api/results/{d}/report?harness={q(h)}&model={q(model)}")
    for oracle in ("hidden_pass", "strong_pass", "visible_pass"):
        out.append(f"/api/harness/ranking?dir={d}&outcome={oracle}")
        # the three decks read the assistant's deterministic digest per (dir, harness, oracle)
        for h in harnesses:
            out.append(f"/api/assist/context?results={d}&harness={q(h)}&oracle={oracle}")
            out.append(f"/api/results/{d}/patterns?harness={q(h)}&outcome={oracle}")
        for a, b in (("model", "harness_id"), ("harness_id", "model"),
                     ("model", "task_id"), ("harness_id", "task_id")):
            out.append(f"/api/results/{d}/experiment?a={a}&b={b}&outcome={oracle}")
    for r in rows[:n_runs]:
        # Same sample as the two per-run URLs above (rows[:n_runs], the bounded set this
        # module already accepts the size of): the per-call detail RepeatsChart fetches only
        # for the opened/highlighted run. A run outside this sample still renders its step
        # line from the /api/repeats/{d} series above; only its hover tooltip's per-call
        # command text needs the live app (RepeatsChart.jsx degrades that path already --
        # `detail` stays null and the tooltip just omits the command line).
        out += [f"/api/results/{d}/runs/{r['run_id']}", f"/api/fork/{d}/state/{r['run_id']}",
                f"/api/repeats/{d}/run/{r['run_id']}"]
    return list(dict.fromkeys(out))


def _urls(client, dirs: list[str], n_runs: int) -> list[str]:
    """Every read-only URL the pages actually request, expanded over the real dirs/harnesses.

    A flat, deduplicated concatenation of _GLOBAL_URLS and _dir_urls() per dir -- this is the
    shape test_static_export_coverage.py and the export-completeness test both check against;
    build() itself no longer calls this directly (it needs the per-dir split to pin one
    generation per study), but every URL it fetches still comes from exactly these two builders.
    """
    out = list(_GLOBAL_URLS)
    for d in dirs:
        out += _dir_urls(client, d, n_runs)
    seen, uniq = set(), []
    for u in out:
        if u not in seen:
            seen.add(u); uniq.append(u)
    return uniq


def default_dirs() -> list[str]:
    """Results directories a default export includes: never the private ones (see results_scope)."""
    return list_results_dirs(RUNS_ROOT)


#: How many times build() re-reads a dir's WHOLE URL set from scratch when its index.jsonl moved
#: under it mid-bake, before giving up on that one dir (see "PIN ONE GENERATION" in build()).
_GENERATION_ATTEMPTS = 3


def _generation_fingerprint(d: str) -> tuple:
    """The identity of results dir `d`'s index.jsonl right now: a thin, deferred-import wrapper
    around app.py's `_study_fingerprint` -- the SAME identity `_StudyCache` and
    `_study_rows_stable` already key their own freshness on, so "this dir's cached responses are
    fresh" and "this dir did not move during the bake" are the same check. Kept as its own
    module-level name (rather than inlined at each call site in build()) so it -- and only the
    two checks build() makes around a dir's whole URL batch -- can be patched in a test without
    touching every request-scoped fingerprint check the live routes make internally."""
    from .app import _study_fingerprint
    return _study_fingerprint(d)


def _fetch(client, url: str, sink: dict, fail_sink: list) -> None:
    """One GET, filed into `sink` (keyed the way the frontend's request-cache key is: the URL
    with the leading /api stripped) on 200, or into `fail_sink` otherwise. Shared by build()'s
    global-URL pass and its per-dir generation-pinned pass so both fail the same way."""
    try:
        r = client.get(url)
        if r.status_code == 200:
            key = url[len("/api"):]
            sink[key] = redact(key, r.json())
        else:
            fail_sink.append((url, r.status_code))
    except Exception as e:                                # one bad URL must not sink the export
        fail_sink.append((url, f"{type(e).__name__}: {e}"))


def ledger_coverage(data: dict, dirs: list[str]) -> dict:
    """Actual run-detail coverage, counted from committed responses, never the requested limit.

    Missing index responses have unknown coverage, including a generation that could not be
    pinned. Only details matching a baked index row count; an unrelated key cannot fill a gap.
    """
    coverage = {}
    for d in dirs:
        rows = data.get(f"/results/{d}/runs")
        if not isinstance(rows, list):
            coverage[d] = {"index_rows": None, "indexed_runs": None, "embedded_runs": 0,
                           "missing_runs": None, "complete": False}
            continue
        ids = {r["run_id"] for r in rows if isinstance(r, dict) and isinstance(r.get("run_id"), str)}
        embedded = sum(f"/results/{d}/runs/{run_id}" in data for run_id in ids)
        coverage[d] = {"index_rows": len(rows), "indexed_runs": len(ids), "embedded_runs": embedded,
                       "missing_runs": len(ids) - embedded,
                       "complete": embedded == len(ids) == len(rows)}
    return coverage


def _data_banner(data: dict, compress_data: bool = False) -> str:
    blob = json.dumps(data, separators=(",", ":"), allow_nan=False)
    if not compress_data:
        # Escape every '<', including HTML's script double-escaped-state opener, rather
        # than only closing tags. JSON.parse and the historical assignment agree on it.
        return '<script>window.__TRACEHARNESS_DATA__=' + blob.replace("<", "\\u003c") + ';</script>'

    raw = blob.encode("utf-8")
    if len(raw) > MAX_DATA_BYTES:
        raise ValueError(f"snapshot exceeds the compressed export's {MAX_DATA_BYTES // (1024 * 1024)} MiB decoded limit")
    compressed = gzip.compress(raw, mtime=0)
    if len(compressed) > MAX_COMPRESSED_DATA_BYTES:
        raise ValueError("compressed snapshot exceeds the export's compressed-data limit")
    encoded = base64.b64encode(compressed).decode("ascii")
    # Base64 is inert HTML text, never a JavaScript literal; the engine parses only this
    # small bootstrap. Native gzip also checks its checksum/trailer before data is exposed.
    banner = (f'<script id="traceharness-data" type="application/octet-stream" '
              f'data-encoding="gzip-base64" data-bytes="{len(raw)}">{encoded}</script>')
    bootstrap = r'''<script>
window.__TRACEHARNESS_DATA_READY__ = (async function () {
  const source = document.getElementById('traceharness-data');
  if (!source || source.dataset.encoding !== 'gzip-base64') throw new Error('The embedded data format is unsupported.');
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decompress the export. Open it in a current browser, or create an export without --export-compress-data.');
  const expected = Number(source.dataset.bytes);
  if (!Number.isSafeInteger(expected) || expected <= 0 || expected > MAX_DECODED_BYTES) throw new Error('The embedded data size is invalid or exceeds the export limit.');
  let encoded = source.textContent;
  if (!encoded.length || encoded.length > MAX_BASE64_BYTES || encoded.length % 4) throw new Error('The embedded compressed data is incomplete or too large.');
  const chunks = [];
  let compressedBytes = 0;
  for (let offset = 0; offset < encoded.length; offset += 65536) {
    const part = atob(encoded.slice(offset, offset + 65536));
    compressedBytes += part.length;
    if (compressedBytes > MAX_COMPRESSED_BYTES) throw new Error('The embedded compressed data is too large.');
    const bytes = new Uint8Array(part.length);
    for (let i = 0; i < part.length; i++) bytes[i] = part.charCodeAt(i);
    chunks.push(bytes);
  }
  encoded = null;
  source.textContent = '';
  const reader = new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  chunks.length = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expected || total > MAX_DECODED_BYTES) throw new Error('The embedded data exceeds its declared size.');
      parts.push(decoder.decode(value, { stream: true }));
    }
    if (total !== expected) throw new Error('The embedded data is incomplete.');
    parts.push(decoder.decode());
  } catch (error) {
    await reader.cancel().catch(function () {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const data = JSON.parse(parts.join(''));
  parts.length = 0;
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.__meta__?.static !== true || !Array.isArray(data.__meta__.results)) throw new Error('The embedded snapshot is invalid.');
  window.__TRACEHARNESS_DATA__ = data;
  return data;
})();
window.__TRACEHARNESS_DATA_READY__.catch(function (error) {
  function showFailure() {
    const root = document.getElementById('root') || document.body;
    const panel = document.createElement('div');
    panel.id = 'traceharness-export-error';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'max-width:620px;margin:12vh auto;padding:24px;font:16px/1.6 system-ui,sans-serif';
    const title = document.createElement('h1');
    title.textContent = 'The recorded data could not be loaded.';
    const detail = document.createElement('p');
    detail.textContent = error instanceof Error ? error.message : 'The export is incomplete or unsupported.';
    const help = document.createElement('p');
    help.textContent = 'Reload the page or open a fresh export. No recorded data or saved harnesses were changed.';
    panel.append(title, detail, help);
    const member = window.__TRACEHARNESS_MEMBER__;
    if (member?.version === 1 && /^[a-f0-9]{24}$/.test(member.scope) && /^https?:$/.test(location.protocol)) {
      const link = document.createElement('a');
      link.href = '/app/shallow';
      link.textContent = 'Open the simple harness editor';
      panel.append(link);
    }
    root.replaceChildren(panel);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showFailure, { once: true });
  else showFailure();
});
</script>'''
    return banner + "\n" + bootstrap.replace("MAX_DECODED_BYTES", str(MAX_DATA_BYTES)).replace(
        "MAX_COMPRESSED_BYTES", str(MAX_COMPRESSED_DATA_BYTES)).replace(
        "MAX_BASE64_BYTES", str(4 * ((MAX_COMPRESSED_DATA_BYTES + 2) // 3)))


def build(out_path: str, results: list[str] | None = None, n_runs: int = DEFAULT_RUNS,
          *, compress_data: bool = False) -> dict:
    index = os.path.join(DIST, "index.html")
    if not os.path.exists(index):
        raise SystemExit("the UI is not built. Run: cd traceharness/frontend && npm install && npm run build")

    dirs = results or default_dirs()
    if not dirs:
        raise SystemExit(f"no results directories under {RUNS_ROOT}")

    from starlette.testclient import TestClient
    from .app import app

    # confirm_private_export() already gated a private dir on an explicit yes (see __main__.py);
    # this is the same opt-in the HTTP guard needs to actually serve it through the TestClient.
    private = any(is_private(RUNS_ROOT, d) for d in dirs)
    data, failed = {}, []
    with TestClient(app, headers={OPT_IN_HEADER: "1"} if private else None) as client:
        for url in _GLOBAL_URLS:                          # no study revision to disagree about
            _fetch(client, url, data, failed)

        # PIN ONE GENERATION for the whole bake (docs/superpowers/specs/2026-09-21-study-
        # aggregates-design.md #4): comparisons, oracle, experiment/fit and every other
        # study-aggregate response embedded for one dir must all come from the SAME read of its
        # index.jsonl, never from two different writer generations landing in the same exported
        # file. _study_fingerprint (the identity _StudyCache and _study_rows_stable already key
        # on in app.py: real path, st_dev, st_ino, st_size, st_mtime_ns, st_ctime_ns) is stat'd
        # here BEFORE requesting `d`'s whole URL set and again AFTER; only a match commits the
        # batch. A mismatch means index.jsonl was touched mid-bake -- rather than mixing that
        # batch's early responses (read under the old generation) with anything baked afterwards
        # (a new generation), the WHOLE batch for `d` is discarded and re-fetched from scratch,
        # up to _GENERATION_ATTEMPTS times. A dir that still will not hold still is dropped from
        # the export entirely (recorded once in `failed`, none of its keys baked) rather than
        # shipped as a silent mix of generations. This is the same best-effort guarantee
        # app.py's own fingerprint documents -- it narrows the race, it does not close it -- but
        # it is a real, checkable improvement over baking each URL independently with no relation
        # between them at all.
        for d in dirs:
            pinned, last_mismatch = False, None
            for _attempt in range(_GENERATION_ATTEMPTS):
                try:
                    fp_before = _generation_fingerprint(d)
                except OSError as e:
                    failed.append((f"(generation) {d}", f"{type(e).__name__}: {e}"))
                    break
                snap, snap_failed = {}, []
                for url in _dir_urls(client, d, n_runs):
                    _fetch(client, url, snap, snap_failed)
                try:
                    fp_after = _generation_fingerprint(d)
                except OSError as e:
                    failed.append((f"(generation) {d}", f"{type(e).__name__}: {e}"))
                    break
                if fp_before == fp_after:
                    data.update(snap)
                    failed += snap_failed
                    pinned = True
                    break
                last_mismatch = (fp_before, fp_after)
            if not pinned and last_mismatch is not None:
                failed.append((f"(generation) {d}",
                               f"index.jsonl changed during export across {_GENERATION_ATTEMPTS} "
                               f"attempts; {d}'s study-aggregate endpoints were skipped rather "
                               f"than baked from a mixed generation"))

    coverage = ledger_coverage(data, dirs)
    data["__meta__"] = {"generated_at": time.strftime("%Y-%m-%d %H:%M"), "results": dirs,
                        "static": True, "runs_embedded": n_runs,
                        "runs_limit_per_dataset": n_runs, "ledger_coverage": coverage}

    with open(index, encoding="utf-8") as f:
        html = f.read()

    def inline(m):
        tag, url = m.group(0), m.group(2)
        p = os.path.join(DIST, url.lstrip("/"))
        if not os.path.exists(p):
            return tag
        with open(p, encoding="utf-8") as f:
            body = f.read()
        if url.endswith(".svg"):
            encoded = base64.b64encode(body.encode("utf-8")).decode("ascii")
            return tag.replace(f'href="{url}"', f'href="data:image/svg+xml;base64,{encoded}"', 1)
        if url.endswith(".css"):
            return f"<style>\n{body}\n</style>"
        if url.endswith(".js"):
            # A compressed snapshot is async. Hold the entire compiled app before its
            # module-level IS_STATIC/cache initialization reads __TRACEHARNESS_DATA__.
            ready = '''if (!window.__TRACEHARNESS_DATA_READY__) {
  const panel = document.createElement('div');
  panel.id = 'traceharness-export-error';
  panel.setAttribute('role', 'alert');
  panel.style.cssText = 'max-width:620px;margin:12vh auto;padding:24px;font:16px/1.6 system-ui,sans-serif';
  panel.textContent = 'The recorded data could not be loaded. This exported file is incomplete. Reload the page or open a fresh export.';
  const member = window.__TRACEHARNESS_MEMBER__;
  if (member?.version === 1 && /^[a-f0-9]{24}$/.test(member.scope) && /^https?:$/.test(location.protocol)) {
    const link = document.createElement('a');
    link.href = '/app/shallow';
    link.textContent = 'Open the simple harness editor';
    panel.append(document.createElement('br'), link);
  }
  (document.getElementById('root') || document.body || document.documentElement).replaceChildren(panel);
  throw new Error('The embedded data bootstrap is missing.');
}
await window.__TRACEHARNESS_DATA_READY__;
''' if compress_data else ""
            body = re.sub(r"</script", lambda m: m[0].replace("/", "\\/"), body, flags=re.I)
            return f'<script type="module">\n{ready}{body}\n</script>'
        return tag

    # drop remote font links: a file meant to open offline must not hang on a network fetch.
    # The CSS carries a system-font fallback stack, so this costs the webfont and nothing else.
    html = re.sub(r'<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>', "", html)
    html = re.sub(r'<link[^>]*rel="icon"[^>]*(href)="([^"]+)"[^>]*>', inline, html)
    html = re.sub(r'<link[^>]*rel="stylesheet"[^>]*(href)="([^"]+)"[^>]*>', inline, html)
    html = re.sub(r'<script[^>]*(src)="([^"]+)"[^>]*></script>', inline, html)

    banner = _data_banner(data, compress_data)
    html = html.replace("</head>", banner + "\n</head>", 1) if "</head>" in html else banner + html

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    return {"path": os.path.abspath(out_path), "bytes": len(html.encode()),
            "results": dirs, "endpoints": len(data) - 1, "failed": failed,
            "runs_embedded": n_runs, "ledger_coverage": coverage,
            "embedded_run_details": sum(c["embedded_runs"] for c in coverage.values()),
            "data_encoding": "gzip-base64" if compress_data else "json"}
