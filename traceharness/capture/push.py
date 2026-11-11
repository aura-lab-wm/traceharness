"""``traceharness capture push``: send captured runs to the signed-in TraceHarness account.

What leaves the machine, in order of the checks:
  1. only runs whose source session file lies under the capture allow-list (~/.traceharness/capture.json);
  2. every string in summary, ledger and patch passes through capture.redact first;
  3. a run whose payload exceeds 4 MiB is skipped and reported, never truncated silently;
  4. a run whose redacted payload hash matches ~/.traceharness/sync.json is not sent again.

Uploads carry the capture token in the Authorization header only. Standard library only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import socket
import sys
import tempfile
import time
from datetime import datetime
from typing import Iterable, Optional

from . import allowlist, cursors, remote
from .redact import redact

SOURCES = ("claude_code", "codex", "gemini_cli", "qwen_code", "cursor")
MAX_BODY = 4 * 1024 * 1024
RUN_ID_RE = re.compile(r"^[A-Za-z0-9_.@-]{1,120}$")
GAP_S = 30 * 60.0
RETRY_WAIT_S = 2.0


# --- reading what the capture spine wrote ---------------------------------------------------------

def _read_run_dir(run_dir: str) -> Optional[dict]:
    """{"summary","ledger","patch"} from a writer output directory, or None if it is not one."""
    try:
        with open(os.path.join(run_dir, "summary.json"), encoding="utf-8") as f:
            summary = json.load(f)
        ledger = []
        with open(os.path.join(run_dir, "ledger.jsonl"), encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    ledger.append(json.loads(line))
        patch = ""
        try:
            with open(os.path.join(run_dir, "patch.diff"), encoding="utf-8", errors="replace") as f:
                patch = f.read()
        except OSError:
            pass
    except (OSError, ValueError):
        return None
    if not isinstance(summary, dict) or not ledger:
        return None
    return {"summary": summary, "ledger": ledger, "patch": patch}


def _source_of(ledger: list) -> str:
    for span in ledger:
        if isinstance(span, dict) and span.get("span") == "invoke_agent" and span.get("status") == "start":
            return str(span.get("import_source") or "")
    return ""


def _iso(value) -> Optional[str]:
    if not isinstance(value, str) or not value:
        return None
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return value


def build_payload(run_id: str, parts: dict, machine: str) -> dict:
    """The POST /api/capture/runs body, redacted. user_id is never part of it."""
    ledger = parts["ledger"]
    summary = parts["summary"]
    payload = {
        "run_id": run_id,
        "source": _source_of(ledger),
        "summary": redact(summary),
        "ledger": redact(ledger),
        "machine": machine[:80],
        "truncated": False,
    }
    patch = redact(parts["patch"] or "")
    if patch:
        payload["patch"] = patch
    at = _iso(summary.get("finished_at")) or _iso(summary.get("started_at"))
    if at:
        payload["captured_at"] = at
    return payload


def _source_files_by_name(roots: list[str]) -> dict:
    from .backfill import source_files
    found, _ = source_files(roots)
    return {os.path.basename(p): p for p, _a in found}


class Item:
    __slots__ = ("run_id", "source", "payload", "source_path")

    def __init__(self, run_id, source, payload, source_path):
        self.run_id, self.source, self.payload, self.source_path = run_id, source, payload, source_path


def collect(runs_root: str, roots: list[str], *, source: str = "", run: str = "",
            only: Optional[Iterable[str]] = None, machine: str = "") -> tuple[list[Item], list[tuple[str, str]]]:
    """(items to consider, [(run_id, reason)] skipped). Reads the lab only; sources are not opened,
    except to find a run's file by name when the watcher's cursors do not know it."""
    out_root = os.path.join(runs_root, "captured")
    skipped: list[tuple[str, str]] = []
    owner: dict[str, str] = {}
    for path, c in cursors.load(cursors.path_for(runs_root)).items():
        if isinstance(c, dict):
            for rid in c.get("runs") or []:
                owner[str(rid)] = path
    wanted = set(only) if only is not None else None
    on_disk = []
    try:
        on_disk = sorted(n for n in os.listdir(out_root)
                         if os.path.isfile(os.path.join(out_root, n, "ledger.jsonl")))
    except OSError:
        pass
    run_ids = [r for r in on_disk if (not run or r == run) and (wanted is None or r in wanted)]
    by_name: Optional[dict] = None
    items: list[Item] = []
    for rid in run_ids:
        if not RUN_ID_RE.match(rid):
            skipped.append((rid, "run id has characters the site does not accept"))
            continue
        parts = _read_run_dir(os.path.join(out_root, rid))
        if parts is None:
            skipped.append((rid, "unreadable run directory"))
            continue
        src = _source_of(parts["ledger"])
        if src not in SOURCES:
            skipped.append((rid, f"source {src or '(none)'!r} is not one the site accepts"))
            continue
        if source and src != source:
            continue
        path = owner.get(rid, "")
        if not path:                                   # captured by --backfill only: find the file by name
            if by_name is None:
                by_name = _source_files_by_name(roots)
            start = next((s for s in parts["ledger"] if s.get("span") == "invoke_agent"), {})
            path = by_name.get(str(start.get("source_path") or ""), "")
        if not path or not allowlist.is_allowed(path, roots):
            skipped.append((rid, "its source session file is not under the capture allow-list"
                            if path else "its source session file could not be located"))
            continue
        items.append(Item(rid, src, build_payload(rid, parts, machine), path))
    return items, skipped


def collect_session_file(path: str, roots: list[str], *, source: str = "",
                         machine: str = "") -> tuple[list[Item], list[tuple[str, str]]]:
    """Capture one session file through the adapter registry and writer into a temp directory
    (nothing is written to the lab), refusing a file outside the allow-list."""
    real = os.path.realpath(os.path.expanduser(path))
    if not os.path.isfile(real):
        return [], [(path, "no such session file")]
    if not allowlist.is_allowed(real, roots):
        return [], [(path, "the session file is not under the capture allow-list")]
    from . import adapters
    name, _conf = adapters.resolve(real)
    if not name:
        return [], [(path, "no capture adapter recognises this file")]
    if source and name != source:
        return [], [(path, f"this file is a {name} session, not {source}")]
    from .regen import regenerate
    tmp = tempfile.mkdtemp(prefix="traceharness-push-")
    try:
        produced = regenerate(real, tmp, GAP_S, adapter=name)
        items, skipped = [], []
        for r in produced:
            parts = _read_run_dir(os.path.join(tmp, r.run_id))
            if parts is None or not RUN_ID_RE.match(r.run_id) or _source_of(parts["ledger"]) not in SOURCES:
                skipped.append((r.run_id, "not a run the site accepts"))
                continue
            items.append(Item(r.run_id, _source_of(parts["ledger"]), build_payload(r.run_id, parts, machine), real))
        return items, skipped
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# --- sync state ----------------------------------------------------------------------------------

def load_sync() -> dict:
    try:
        with open(remote.sync_path(), encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in doc.items() if isinstance(k, str) and isinstance(v, str)} if isinstance(doc, dict) else {}


def save_sync(state: dict) -> None:
    remote.write_private(remote.sync_path(), json.dumps(state, indent=2, sort_keys=True) + "\n")


# --- sending -------------------------------------------------------------------------------------

def _upload(creds: dict, body: bytes) -> tuple[int, dict]:
    """POST once, retrying one time on a 5xx or a network failure."""
    url = creds["url"] + "/api/capture/runs"
    last_err: Optional[remote.CliError] = None
    for attempt in (0, 1):
        try:
            status, doc = remote.request("POST", url, body, token=creds["token"], timeout=120)
        except remote.CliError as e:
            last_err = e
            status, doc = 0, {}
        else:
            last_err = None
        if status and status < 500:
            return status, doc
        if attempt == 0:
            time.sleep(RETRY_WAIT_S)
    if last_err is not None:
        raise last_err
    return status, doc


def send(items: list[Item], skipped: list[tuple[str, str]], creds: Optional[dict], *,
         dry_run: bool = False, log=lambda s: None) -> dict:
    """Send what changed. Returns a report; raises remote.Unauthorized on a 401 (after saving
    what was already accepted)."""
    report = {"sent": 0, "unchanged": 0, "too_large": 0, "failed": 0, "skipped": len(skipped),
              "would_send": 0, "bytes": 0, "unauthorized": False}
    for rid, why in skipped:
        log(f"skip   {rid}: {why}")
    state = {} if dry_run else load_sync()
    dirty = False
    try:
        for it in items:
            body = json.dumps(it.payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            if len(body) > MAX_BODY:
                report["too_large"] += 1
                log(f"skip   {it.run_id}: {len(body) / 1048576:.1f} MiB is over the 4 MiB limit")
                continue
            digest = hashlib.sha256(body).hexdigest()
            if not dry_run and state.get(it.run_id) == digest:
                report["unchanged"] += 1
                continue
            if dry_run:
                report["would_send"] += 1
                report["bytes"] += len(body)
                log(f"would  {it.run_id} ({it.source}, {len(body)} bytes)")
                continue
            try:
                status, doc = _upload(creds, body)
            except remote.CliError as e:
                report["failed"] += 1
                log(f"fail   {it.run_id}: {e}")
                continue
            if status == 401:
                report["unauthorized"] = True
                raise remote.Unauthorized()
            if status == 200:
                state[it.run_id] = digest
                dirty = True
                report["sent"] += 1
                report["bytes"] += len(body)
                log(f"sent   {it.run_id} ({it.source}, {len(body)} bytes)")
            elif status == 413:
                report["too_large"] += 1
                log(f"skip   {it.run_id}: the site refused it as too large (413)")
            else:
                report["failed"] += 1
                log(f"fail   {it.run_id}: HTTP {status} {remote.server_said(doc)}".rstrip())
    finally:
        if dirty:
            save_sync(state)
    return report


def summarize(report: dict, dry_run: bool) -> str:
    if dry_run:
        return (f"dry run: {report['would_send']} run(s) would be sent ({report['bytes']} bytes), "
                f"{report['too_large']} too large, {report['skipped']} skipped; nothing was sent")
    return (f"{report['sent']} sent, {report['unchanged']} unchanged, {report['too_large']} too large, "
            f"{report['skipped']} skipped, {report['failed']} failed")


def exit_code(report: dict) -> int:
    return 1 if report["failed"] or report["unauthorized"] else 0


def push(runs_root: str, *, source: str = "", run: str = "", session_file: str = "", dry_run: bool = False,
         only: Optional[Iterable[str]] = None, log=lambda s: None) -> dict:
    roots = allowlist.load_paths()
    if not roots:
        raise remote.CliError("nothing to send: the capture allow-list (~/.traceharness/capture.json) is empty")
    creds = None
    if not dry_run:
        creds = remote.load_credentials()
        if not creds:
            raise remote.CliError(f"not signed in: {remote.LOGIN_HINT}")
    machine = socket.gethostname() or ""
    if session_file:
        items, skipped = collect_session_file(session_file, roots, source=source, machine=machine)
    else:
        items, skipped = collect(runs_root, roots, source=source, run=run, only=only, machine=machine)
    return send(items, skipped, creds, dry_run=dry_run, log=log)


def push_main(argv: list[str]) -> int:
    os.environ.setdefault("PYTHON_COLORS", "0")
    p = argparse.ArgumentParser(prog="traceharness capture push", allow_abbrev=False,
                                description="Send captured runs to your TraceHarness account (redacted first).")
    p.add_argument("--source", choices=SOURCES, default="", help="only this agent's runs")
    p.add_argument("--run", default="", metavar="RUN_ID", help="only this run")
    p.add_argument("--session-file", default="", metavar="PATH",
                   help="capture this one session file (it must be under the allow-list), then send it")
    p.add_argument("--dry-run", action="store_true", help="show what would be sent; no network, no sync state")
    p.add_argument("--quiet", action="store_true", help="print nothing unless something went wrong")
    p.add_argument("--lab", default=None, metavar="DIR", help="lab root holding data/runs/")
    args = p.parse_args(argv)
    if args.lab:
        os.environ["TRACEHARNESS_LAB"] = os.path.abspath(os.path.expanduser(args.lab))
    from traceharness.backend.paths import RUNS_ROOT      # after TRACEHARNESS_LAB, as everywhere here

    def log(line: str) -> None:
        if not args.quiet or line.startswith("fail"):
            print(line, file=sys.stderr if line.startswith(("fail", "skip")) else sys.stdout)

    try:
        report = push(RUNS_ROOT, source=args.source, run=args.run, session_file=args.session_file,
                      dry_run=args.dry_run, log=log)
    except remote.Unauthorized as e:
        print(str(e), file=sys.stderr)
        return 1
    except remote.CliError as e:
        print(str(e), file=sys.stderr)
        return 1
    if not args.quiet:
        print(summarize(report, args.dry_run))
    return exit_code(report)


def sync_hook(runs_root: str):
    """The callback `capture --watch --sync` hands the sniffer: push what the last pass changed.

    The first pass sends everything not yet synced; later passes only the runs of sources that
    moved. Silent unless signed in; never raises into the watcher."""
    state = {"first": True, "warned": False}

    def after_pass(rep: dict) -> None:
        try:
            if (rep or {}).get("state") == "locked":
                return
            if not remote.load_credentials():
                if not state["warned"]:
                    state["warned"] = True
                    print(f"--sync: not signed in, nothing is sent ({remote.LOGIN_HINT})", file=sys.stderr)
                return
            only = None
            if not state["first"]:
                only = {r for info in ((rep or {}).get("sources") or {}).values() for r in (info.get("runs") or [])}
                if not only:
                    return
            r = push(runs_root, only=only, log=lambda s: print(s, file=sys.stderr) if s.startswith(("fail", "skip")) else None)
            state["first"] = False
            if r["sent"] or r["failed"]:
                print(f"--sync: {summarize(r, False)}", file=sys.stderr)
        except remote.Unauthorized as e:
            print(f"--sync: {e}", file=sys.stderr)
        except Exception as e:                             # a failed upload must never stop the watcher
            print(f"--sync: {type(e).__name__}: {e}", file=sys.stderr)

    return after_pass
