"""AgentLab Console: the lab's web platform. Standard library only.

    python -m traceharness.core.serve                       # serves every results dir under data/runs on http://127.0.0.1:8766 (legacy console; traceharness owns 8765)
    python -m traceharness.core.serve --results data/runs/live,data/runs/prerecorded_mock --port 9000
    python -m traceharness.core.serve --export console.html # one self-contained HTML file with the data embedded, no server needed

Endpoints
  GET  /                    the app
  GET  /api/bundle          all runs, compact ledgers, features, harnesses, tasks, runs in flight, jobs
  GET  /api/run?results=<dir>&id=<run_id>   one run untruncated (+ patch)
  GET  /api/jobs            runner jobs launched from the console (progress, cost so far, projection, eta)
  GET  /api/status          cheap poll: run count, runs in flight, jobs; the page fetches the bundle only when this changes
  POST /api/jobs/cancel     {"id"} -> SIGTERM to that runner
  POST /api/launch          {"provider","model","harness","tasks","repeats","out","base_url","seed"} -> spawns traceharness.core.runner
  POST /api/harness         {"id", ...HarnessConfig fields} -> writes harnesses/<id>.json

The console is a teaching tool for a local machine: it binds to 127.0.0.1 and has no authentication.
"""
from __future__ import annotations
import argparse, json, os, re, signal, subprocess, sys, threading, time, webbrowser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from .console import build_bundle, default_results_dirs, run_detail, LAB_ROOT

WEB_DIR = os.path.join(LAB_ROOT, "web")
JOBS: list[dict] = []
JOBS_LOCK = threading.Lock()
STATE = {"results": [], "bundle": None, "bundle_time": 0.0}


_PROG = re.compile(r"\[\s*(\d+)/(\d+)\]")
_COST = re.compile(r"\$(\d+\.\d+)")


def _job_view(j: dict) -> dict:
    p = j["proc"]
    rc = p.poll()
    status = "running" if rc is None else ("cancelled" if j.get("cancelled") else ("done" if rc == 0 else f"failed ({rc})"))
    tail, done, total, spent = "", 0, 0, 0.0
    try:
        with open(j["log"], encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        tail = "".join(lines[-12:])
        for line in lines:
            m = _PROG.search(line)
            if m:
                done, total = int(m.group(1)), int(m.group(2))
                c = _COST.search(line)
                if c:
                    spent += float(c.group(1))
    except OSError:
        pass
    elapsed = time.time() - j["t0"]
    projected = spent * total / done if done else None
    return {"id": j["id"], "cmd": j["cmd_display"], "status": status, "started": j["started"], "out": j["out"], "tail": tail,
            "done": done, "total": total, "spent": round(spent, 4), "projected": round(projected, 4) if projected else None,
            "elapsed_s": int(elapsed), "eta_s": int(elapsed / done * (total - done)) if done and total and rc is None else None}


_PROVIDERS = ("mock", "openai", "anthropic", "openrouter")
_MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:@+/-]{0,119}")
_TASKS = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.,-]{0,299}")


def _under(root: str, rel: str, what: str) -> str:
    """`rel` (relative to LAB_ROOT) resolved to a real path inside `root`, else ValueError."""
    if not isinstance(rel, str) or not rel or "\x00" in rel or os.path.isabs(rel) or rel.startswith("-"):
        raise ValueError(f"bad {what}")
    real_root = os.path.realpath(root)
    full = os.path.realpath(os.path.join(LAB_ROOT, rel))
    if not full.startswith(real_root + os.sep):
        raise ValueError(f"{what} must stay inside {os.path.relpath(real_root, LAB_ROOT)}")
    return full


def _check_base_url(url: str) -> str:
    """An OpenAI-compatible endpoint the runner will send the provider key to: https anywhere, or
    plain http only to this machine or a private network (Ollama, vLLM). No credentials in the URL."""
    import ipaddress
    from urllib.parse import urlsplit
    if not isinstance(url, str) or len(url) > 300 or url != url.strip() or any(c.isspace() or ord(c) < 0x20 for c in url):
        raise ValueError("bad base_url")
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme not in ("http", "https") or not host or parts.username or parts.password:
        raise ValueError("base_url must be an http(s) URL without credentials")
    if parts.scheme == "http":
        try:
            ip = ipaddress.ip_address(host)
            private = ip.is_loopback or ip.is_private
        except ValueError:
            private = host == "localhost" or host.endswith(".localhost")
        if not private:
            raise ValueError("plain-http base_url is allowed only for localhost or a private address")
    return url


def launch(spec: dict) -> dict:
    """Validate every request field against what the console sends, then spawn the runner. There is
    no shell, so the risks are argument injection (a value that reads as another flag), a results or
    harness path outside the lab, and a base_url that would receive the provider key."""
    provider = spec.get("provider", "mock")
    model = spec.get("model", "mock")
    tasks = spec.get("tasks", "all")
    if provider not in _PROVIDERS:
        raise ValueError("unknown provider")
    if not isinstance(model, str) or not _MODEL.fullmatch(model):
        raise ValueError("bad model")
    if not isinstance(tasks, str) or not _TASKS.fullmatch(tasks):
        raise ValueError("bad tasks")
    out_rel = spec.get("out") or f"data/runs/console_{time.strftime('%H%M%S')}"
    out_full = _under(os.path.join(LAB_ROOT, "data", "runs"), out_rel, "out")
    out = os.path.relpath(out_full, LAB_ROOT)
    harnesses = []
    for h in str(spec.get("harness") or "").split(","):
        if h.strip():
            hp = _under(os.path.join(LAB_ROOT, "harnesses"), h.strip(), "harness")
            if not hp.endswith(".json"):
                raise ValueError("harness must be a .json file under harnesses/")
            harnesses.append(os.path.relpath(hp, LAB_ROOT))
    cmd = [sys.executable, "-m", "traceharness.core.runner", "--provider", provider, "--model", model,
           "--tasks", tasks, "--repeats", str(int(spec.get("repeats", 1))), "--out", out, "--seed", str(int(spec.get("seed", 0)))]
    if harnesses:
        cmd += ["--harness", ",".join(harnesses)]
    if spec.get("base_url"):
        cmd += ["--base-url", _check_base_url(spec["base_url"])]
    if spec.get("temperature") not in (None, ""):
        cmd += ["--temperature", str(float(spec["temperature"]))]
    os.makedirs(os.path.join(LAB_ROOT, "data", "jobs"), exist_ok=True)
    jid = time.strftime("%H%M%S") + f"-{len(JOBS) + 1}"
    log = os.path.join(LAB_ROOT, "data", "jobs", f"{jid}.log")
    proc = subprocess.Popen(cmd, cwd=LAB_ROOT, stdout=open(log, "w"), stderr=subprocess.STDOUT, env=os.environ.copy())
    job = {"id": jid, "proc": proc, "log": log, "cmd_display": " ".join(cmd[2:]), "started": time.strftime("%H:%M:%S"), "out": out, "t0": time.time()}
    with JOBS_LOCK:
        JOBS.append(job)
    if out_full not in STATE["results"]:
        STATE["results"].append(out_full)
    return _job_view(job)


def current_bundle(force: bool = False) -> dict:
    dirs = list(STATE["results"])
    # pick up results dirs created by console jobs or by hand while the server runs
    for d in default_results_dirs():
        if d not in dirs:
            dirs.append(d)
    STATE["results"] = dirs
    newest = 0.0
    for d in dirs:
        for name in ("index.jsonl",):
            p = os.path.join(d, name)
            if os.path.exists(p):
                newest = max(newest, os.path.getmtime(p))
        try:
            newest = max(newest, os.path.getmtime(d))
        except OSError:
            pass
    with JOBS_LOCK:
        jobs = [_job_view(j) for j in JOBS]
    if force or STATE["bundle"] is None or newest > STATE["bundle_time"] or any(j["status"] == "running" for j in jobs):
        STATE["bundle"] = build_bundle(dirs, jobs=jobs, preview_chars=900)
        STATE["bundle_time"] = time.time()
    else:
        STATE["bundle"]["jobs"] = jobs
    return STATE["bundle"]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter console
        if os.environ.get("AGENTLAB_HTTP_LOG"):
            super().log_message(fmt, *args)

    def _send(self, code: int, body: bytes, ctype: str = "application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text") or "json" in ctype else ""))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode())

    def _guard(self, write: bool) -> bool:
        """Same Host / Origin / Content-Type rules as the main server (backend/guard.py): refuse a
        foreign Host (DNS rebinding) and, on writes, a foreign Origin or a non-JSON body (CSRF)."""
        from traceharness.backend.serve_guard import check_request
        verdict = check_request(self.headers.get("Host"), self.headers.get("Origin"), self.headers.get("Sec-Fetch-Site"),
                                self.headers.get("Content-Type"), write, bound_host=self.server.server_address[0])
        if verdict:
            self._send(verdict[0], verdict[1].encode(), "text/plain")
            return False
        return True

    def do_GET(self):
        if not self._guard(False):
            return
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path in ("/", "/index.html"):
            with open(os.path.join(WEB_DIR, "index.html"), "rb") as f:
                html = f.read()
            self._send(200, html, "text/html")
        elif u.path == "/api/bundle":
            self._json(current_bundle(force="force" in q))
        elif u.path == "/api/run":
            results = q.get("results", [""])[0]
            rid = q.get("id", [""])[0]
            d = next((x for x in STATE["results"] if os.path.basename(x.rstrip("/")) == results), None)
            if not d or not rid:
                return self._json({"error": "unknown results dir or run id"}, 404)
            try:
                self._json(run_detail(d, rid))
            except FileNotFoundError:
                self._json({"error": "run not found"}, 404)
        elif u.path == "/api/jobs":
            with JOBS_LOCK:
                self._json([_job_view(j) for j in JOBS])
        elif u.path == "/api/status":
            # cheap poll: no ledger parsing; the client fetches the bundle only when `version` changes
            with JOBS_LOCK:
                jobs = [_job_view(j) for j in JOBS]
            n_runs = 0
            for d in STATE["results"]:
                ip = os.path.join(d, "index.jsonl")
                if os.path.exists(ip):
                    with open(ip, "rb") as f:
                        n_runs += sum(1 for _ in f)
            running = []
            for d in STATE["results"]:
                if os.path.isdir(d):
                    from .console import running_runs
                    running.extend(running_runs(d))
            self._json({"version": f"{n_runs}:{len(running)}:{sum(1 for j in jobs if j['status'] == 'running')}", "runs": n_runs, "running": running, "jobs": jobs})
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self):
        if not self._guard(True):
            return
        u = urlparse(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return self._json({"error": "bad json"}, 400)
        if u.path == "/api/launch":
            try:
                self._json(launch(body))
            except (ValueError, TypeError, OverflowError) as e:  # a refused field: its message names the field only
                self._json({"error": str(e)}, 400)
            except Exception:
                from traceharness.backend.confine import log_error
                self._json({"error": f"launch failed (error id {log_error('launch')})"}, 500)
        elif u.path == "/api/jobs/cancel":
            jid = body.get("id")
            with JOBS_LOCK:
                j = next((x for x in JOBS if x["id"] == jid), None)
            if not j:
                return self._json({"error": "unknown job"}, 404)
            if j["proc"].poll() is None:
                j["cancelled"] = True
                try:
                    j["proc"].send_signal(signal.SIGTERM)
                except Exception:
                    from traceharness.backend.confine import log_error
                    return self._json({"error": f"cancel failed (error id {log_error('cancel')})"}, 500)
            self._json(_job_view(j))
        elif u.path == "/api/harness":
            hid = (body.get("id") or "").strip()
            if not hid or not hid.replace("_", "").replace("-", "").isalnum():
                return self._json({"error": "harness id must be alphanumeric/underscore"}, 400)
            from .harness import HarnessConfig
            from dataclasses import asdict
            allowed = set(asdict(HarnessConfig()).keys())
            cfg = HarnessConfig(**{k: v for k, v in body.items() if k in allowed})
            path = os.path.join(LAB_ROOT, "harnesses", f"{hid}.json")
            cfg.save(path)
            STATE["bundle"] = None
            self._json({"ok": True, "path": os.path.relpath(path, LAB_ROOT)})
        else:
            self._send(404, b"not found", "text/plain")


def export_static(results_dirs: list[str], out_path: str, preview_chars: int = 900) -> str:
    bundle = build_bundle(results_dirs, preview_chars=preview_chars)
    bundle["static"] = True
    with open(os.path.join(WEB_DIR, "index.html"), encoding="utf-8") as stream:
        html = stream.read()
    payload = json.dumps(bundle).replace("</", "<\\/")
    marker = "/*__BUNDLE__*/"
    assert marker in html, "index.html is missing the bundle marker"
    html = html.replace(marker, "window.__BUNDLE__ = " + payload + ";")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    return out_path


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", default=None, help="comma-separated results dirs (default: every dir under data/runs)")
    ap.add_argument("--port", type=int, default=8766)   # 8765 is traceharness; the legacy console sits beside it
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--export", default=None, help="write a self-contained HTML file and exit")
    ap.add_argument("--preview-chars", type=int, default=900, help="tool-output characters kept per span in the bundle")
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args(argv)
    dirs = [os.path.abspath(p.strip()) for p in a.results.split(",")] if a.results else default_results_dirs()
    if a.export:
        p = export_static(dirs, a.export, a.preview_chars)
        print(f"wrote {p} ({os.path.getsize(p) / 1e6:.1f} MB) from {len(dirs)} results dir(s)")
        return
    STATE["results"] = dirs
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    url = f"http://{a.host}:{a.port}/"
    print(f"AgentLab Console on {url}   results: {', '.join(os.path.relpath(d, LAB_ROOT) for d in dirs) or '(none yet)'}")
    if not a.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
