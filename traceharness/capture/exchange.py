"""``traceharness capture export`` and ``traceharness capture import``: move captured sessions between
machines as one zip, with no account and no network.

Export reads ``data/runs/captured/`` (the runs the capture spine already wrote), passes every string
through ``capture.redact`` -- the same redaction as before -- and writes a zip::

    manifest.json                        format, version, created_at, redaction version, sources, files
    index.jsonl                          the dataset-index rows of the exported runs
    runs/<run_id>/summary.json
    runs/<run_id>/ledger.jsonl
    runs/<run_id>/patch.diff             only when the run has a patch

Redaction keeps the original bytes of a line (or file) it did not change, so a session without secrets
comes back from export + import byte for byte.

Import is the untrusted-input path: the zip may come from anyone. Nothing in it is executed, and no
member name is ever used as a path. The archive is read into memory, every check runs, and only then
is anything written:

  * the manifest must be ``traceharness-capture-export`` at a version this code knows;
  * every member must be a plain file named exactly like a manifest entry (``runs/<id>/<known file>``
    or ``index.jsonl``): no ``..``, absolute, backslash, drive or control-character names, no
    duplicate names (also case-insensitively), no extra member, no symlink or other special file,
    no directory entry, no encrypted member;
  * an entry over MAX_ENTRY_BYTES (declared or actually decompressed), more than MAX_ENTRIES members, or
    more than MAX_TOTAL_BYTES in total is refused, so a zip bomb never inflates;
  * the SHA-256 and size of every member must equal the manifest's;
  * the ledger must be JSON lines and the summary a JSON object naming the same run.

Existing runs are never overwritten: a run already in the lab is skipped and reported.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import tempfile
import zipfile
from datetime import datetime, timezone
from typing import Iterable, Optional

from .lock import CaptureLock
from .redact import REDACTION_VERSION, redact, redact_text
from .sources import SOURCES
from traceharness.core.span_schema import first_span_problem, loads_finite, span_problem   # one definition, shared with the runner's datasets

FORMAT = "traceharness-capture-export"
VERSION = 1
KNOWN_VERSIONS = frozenset({1})
MANIFEST = "manifest.json"
INDEX = "index.jsonl"
RUN_FILES = ("summary.json", "ledger.jsonl", "patch.diff")
REQUIRED = ("summary.json", "ledger.jsonl")

MAX_ENTRY_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
MAX_ENTRIES = 3 * 20000 + 2
MAX_MANIFEST_BYTES = 16 * 1024 * 1024

RUN_ID_RE = re.compile(r"^(?!\.{1,2}$)[A-Za-z0-9_.@-]{1,120}$")
_MEMBER_RE = re.compile(r"^runs/([A-Za-z0-9_.@-]{1,120})/(summary\.json|ledger\.jsonl|patch\.diff)$")
_ZIP_TIME = (1980, 1, 1, 0, 0, 0)


class ExchangeError(Exception):
    """A refusal, in words meant for the person at the terminal. Nothing was written."""


# --- import-side schema ---------------------------------------------------------------------------
# What a RunSummary (summary.json, an index row) may hold, by JSON type. A value of the wrong type or a
# non-finite number is refused before anything is written: a stored NaN later breaks every JSON response
# that serves the run.
_S_STR = ("run_id", "task_id", "harness_id", "model", "provider", "started_at")
_S_STR_OPT = ("finished_at", "exit_reason", "error", "harness_hash")
_S_INT = ("repeat_index",)
_S_INT_NULL = ("steps", "sentinel_interventions", "tool_calls", "edits", "lines_added", "lines_removed",
               "boundary_events", "tests_run_by_agent", "input_tokens", "output_tokens", "wall_ms", "patch_bytes",
               "reprompts", "human_interventions")
_S_NUM_NULL = ("sentinel_max_risk", "sentinel_cost_usd", "cost_usd")
_S_BOOL_NULL = ("ran_tests_before_submit", "visible_pass", "hidden_pass", "strong_pass", "tests_modified", "human_intervened")
_S_LIST_NULL = ("files_touched", "boundary_kinds", "served_by")      # every element is text (core/analysis.py counts boundary_kinds)


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def check_summary_row(row, what: str) -> None:
    """Raise ExchangeError unless `row` is a well-typed RunSummary object (extra provenance keys are kept)."""
    if not isinstance(row, dict):
        raise ExchangeError(f"{what} is not a JSON object")
    bad = [k for k in _S_STR if not isinstance(row.get(k), str)]
    bad += [k for k in _S_STR_OPT if k in row and not isinstance(row[k], str)]
    bad += [k for k in _S_INT if not _is_int(row.get(k))]
    bad += [k for k in _S_INT_NULL if row.get(k) is not None and not _is_int(row[k])]
    bad += [k for k in _S_NUM_NULL if row.get(k) is not None and (isinstance(row[k], bool) or not isinstance(row[k], (int, float)))]
    bad += [k for k in _S_BOOL_NULL if row.get(k) is not None and not isinstance(row[k], bool)]
    bad += [k for k in _S_LIST_NULL if row.get(k) is not None and not (isinstance(row[k], list) and all(isinstance(x, str) for x in row[k]))]
    if bad:
        raise ExchangeError(f"{what} has fields of the wrong type or missing: {', '.join(sorted(set(bad))[:5])}")


def check_ledger_line(span, what: str, first: bool = False) -> None:
    problem = span_problem(span) or (first_span_problem(span) if first else None)
    if problem:
        raise ExchangeError(f"{what} is not a ledger span the readers of a run can take ({problem}); nothing was imported")


# --- export ---------------------------------------------------------------------------------------

def _read_file(directory_fd: int, name: str) -> Optional[bytes]:
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    except FileNotFoundError:
        return None
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError(f"{name} is not a regular file")
        data = stream.read(MAX_ENTRY_BYTES + 1)
    if len(data) > MAX_ENTRY_BYTES:
        raise ValueError(f"{name} is larger than {MAX_ENTRY_BYTES} bytes")
    return data


def read_run_dir(run_dir: str) -> Optional[dict]:
    """{name: bytes} for a captured run directory, or None if it is not a readable run. Symlinks
    are never followed."""
    parent = directory = None
    try:
        parent = os.open(os.path.dirname(run_dir), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        directory = os.open(os.path.basename(run_dir), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=parent)
        out = {}
        for name in RUN_FILES:
            data = _read_file(directory, name)
            if data is not None:
                out[name] = data
    except (OSError, ValueError):
        return None
    finally:
        for fd in (directory, parent):
            if fd is not None:
                os.close(fd)
    return out if all(n in out for n in REQUIRED) else None


def _redact_json_lines(data: bytes) -> bytes:
    """Redact each JSON line; a line the redactor leaves unchanged keeps its original bytes."""
    out = []
    for raw in data.decode("utf-8").splitlines(keepends=True):
        if not raw.strip():
            out.append(raw)
            continue
        value = json.loads(raw)
        red = redact(value)
        if red == value:
            out.append(raw)
        else:
            tail = raw[len(raw.rstrip("\r\n")):]
            out.append(json.dumps(red, ensure_ascii=False) + tail)
    return "".join(out).encode("utf-8")


def redact_files(files: dict) -> dict:
    """The bytes that leave the machine for one run: the same redaction `capture push` applied."""
    out = {}
    summary = json.loads(files["summary.json"].decode("utf-8"))
    red = redact(summary)
    out["summary.json"] = files["summary.json"] if red == summary else json.dumps(
        red, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8")
    out["ledger.jsonl"] = _redact_json_lines(files["ledger.jsonl"])
    if "patch.diff" in files:
        text = files["patch.diff"].decode("utf-8")
        red_text = redact_text(text)
        out["patch.diff"] = files["patch.diff"] if red_text == text else red_text.encode("utf-8")
    return out


def source_of(ledger: bytes) -> str:
    for raw in ledger.decode("utf-8").splitlines():
        if not raw.strip():
            continue
        span = json.loads(raw)
        if isinstance(span, dict) and span.get("span") == "invoke_agent" and span.get("status") == "start":
            return str(span.get("import_source") or "")
    return ""


def parse_since(text: str) -> datetime:
    """`2026-11-01` or a full ISO timestamp; a date alone means the start of that day, UTC."""
    try:
        when = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    except ValueError:
        raise ExchangeError(f"--since {text!r} is not a date: use YYYY-MM-DD or an ISO timestamp") from None
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def _when(summary: dict, row: Optional[dict]) -> Optional[datetime]:
    for source in (summary, row or {}):
        for key in ("finished_at", "started_at", "last_ts"):
            value = source.get(key)
            if isinstance(value, str) and value:
                try:
                    when = datetime.fromisoformat(value.replace("Z", "+00:00"))
                except ValueError:
                    continue
                return when if when.tzinfo else when.replace(tzinfo=timezone.utc)
    return None


def _index_rows(path: str) -> dict:
    rows = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if isinstance(row, dict) and isinstance(row.get("run_id"), str):
                    rows[row["run_id"]] = row
    except OSError:
        pass
    return rows


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def export_archive(runs_root: str, out_path: str, *, sources: Iterable[str] = (), since: str = "",
                   now: Optional[datetime] = None) -> dict:
    """Write the zip. Returns {"runs", "skipped": [(run_id, reason)], "bytes", "path"}."""
    wanted = set(sources)
    unknown = sorted(wanted - set(SOURCES))
    if unknown:
        raise ExchangeError(f"unknown source {unknown[0]!r}: one of {', '.join(SOURCES)}")
    cutoff = parse_since(since) if since else None
    out_path = os.path.abspath(os.path.expanduser(out_path))
    if os.path.lexists(out_path):
        raise ExchangeError(f"{out_path} already exists; choose another --out")
    if not os.path.isdir(os.path.dirname(out_path)):
        raise ExchangeError(f"the folder for {out_path} does not exist")
    cap = os.path.join(runs_root, "captured")
    try:
        names = sorted(n for n in os.listdir(cap)
                       if os.path.isfile(os.path.join(cap, n, "ledger.jsonl")))
    except OSError:
        names = []
    rows = _index_rows(os.path.join(cap, "index.jsonl"))
    members: dict[str, bytes] = {}
    runs, index_lines, skipped = [], [], []
    total = 0
    for run_id in names:
        if not RUN_ID_RE.match(run_id):
            skipped.append((run_id, "run id has characters the archive format does not accept"))
            continue
        files = read_run_dir(os.path.join(cap, run_id))
        if files is None:
            skipped.append((run_id, "unreadable run directory"))
            continue
        try:
            src = source_of(files["ledger.jsonl"])
            summary = json.loads(files["summary.json"].decode("utf-8"))
            if not isinstance(summary, dict):
                raise ValueError("summary is not an object")
            red = redact_files(files)
        except (ValueError, UnicodeDecodeError):
            skipped.append((run_id, "its summary or ledger is not valid"))
            continue
        if src not in SOURCES:
            skipped.append((run_id, f"source {src or '(none)'!r} is not a capture source"))
            continue
        if wanted and src not in wanted:
            continue
        if cutoff is not None:
            when = _when(summary, rows.get(run_id))
            if when is None or when < cutoff:
                continue
        size = sum(len(v) for v in red.values())
        if total + size > MAX_TOTAL_BYTES:
            skipped.append((run_id, "the archive size limit was reached"))
            continue
        total += size
        for name, data in red.items():
            members[f"runs/{run_id}/{name}"] = data
        row = rows.get(run_id) or dict(summary, root_uuid="")
        index_lines.append(json.dumps(redact(row), ensure_ascii=False, sort_keys=True))
        runs.append({"run_id": run_id, "source": src})
    if index_lines:
        members[INDEX] = ("\n".join(index_lines) + "\n").encode("utf-8")
    now = now or datetime.now(timezone.utc)
    manifest = {
        "format": FORMAT,
        "version": VERSION,
        "created_at": now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "redaction_version": REDACTION_VERSION,
        "sources": sorted({r["source"] for r in runs}),
        "runs": runs,
        "files": [{"path": p, "sha256": _sha(d), "size": len(d)} for p, d in sorted(members.items())],
    }
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(out_path), prefix=".tmp-export-", suffix=".zip")
    try:
        with os.fdopen(fd, "wb") as raw, zipfile.ZipFile(raw, "w", zipfile.ZIP_DEFLATED) as z:
            for name, data in [(MANIFEST, json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8")),
                               *sorted(members.items())]:
                info = zipfile.ZipInfo(name, _ZIP_TIME)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                z.writestr(info, data)
        os.chmod(tmp, 0o600)
        os.link(tmp, out_path)                       # fails if something appeared at out_path meanwhile
    except FileExistsError:
        raise ExchangeError(f"{out_path} already exists; choose another --out") from None
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    return {"runs": len(runs), "skipped": skipped, "bytes": os.path.getsize(out_path), "path": out_path,
            "sources": manifest["sources"]}


# --- import ---------------------------------------------------------------------------------------

def is_export_archive(path: str) -> bool:
    """True when `path` is a zip whose manifest names this format (any version)."""
    try:
        if not zipfile.is_zipfile(path):
            return False
        with zipfile.ZipFile(path) as z:
            info = z.getinfo(MANIFEST)
            if info.file_size > MAX_MANIFEST_BYTES:
                return False
            doc = json.loads(z.read(info))
        return isinstance(doc, dict) and doc.get("format") == FORMAT
    except (OSError, KeyError, ValueError, zipfile.BadZipFile):
        return False


def _read_member(z: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int) -> bytes:
    with z.open(info) as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ExchangeError(f"{info.filename!r} is larger than the {limit} byte limit")
    return data


def _check_member_name(name: str) -> None:
    if (name != MANIFEST and name != INDEX and not _MEMBER_RE.match(name)) or ".." in name.split("/"):
        raise ExchangeError(f"refusing archive member with an unexpected name: {name!r}")


def verify_archive(path: str) -> dict:
    """Read and verify the whole archive in memory. Returns {"manifest", "runs": {id: {file: bytes}},
    "index": [rows]}. Raises ExchangeError at the first problem; touches no file in the lab."""
    try:
        z = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as e:
        raise ExchangeError(f"{path} is not a readable zip archive ({type(e).__name__})") from None
    with z:
        infos = z.infolist()
        if len(infos) > MAX_ENTRIES:
            raise ExchangeError(f"the archive has {len(infos)} members; the limit is {MAX_ENTRIES}")
        seen, folded = set(), set()
        declared = 0
        for info in infos:
            name = info.filename
            if "\x00" in name or "\\" in name or name.startswith("/") or re.match(r"^[A-Za-z]:", name):
                raise ExchangeError(f"refusing archive member with an unsafe name: {name!r}")
            if name in seen or name.casefold() in folded:
                raise ExchangeError(f"the archive lists {name!r} twice")
            seen.add(name)
            folded.add(name.casefold())
            _check_member_name(name)
            mode = (info.external_attr >> 16) & 0xFFFF
            if info.is_dir() or (stat.S_IFMT(mode) and not stat.S_ISREG(mode)):
                raise ExchangeError(f"refusing {name!r}: it is a link, directory or special file, not a plain file")
            if info.flag_bits & 0x1:
                raise ExchangeError(f"refusing {name!r}: it is encrypted")
            if info.file_size > (MAX_MANIFEST_BYTES if name == MANIFEST else MAX_ENTRY_BYTES):
                raise ExchangeError(f"{name!r} is larger than the size limit")
            declared += info.file_size
            if declared > MAX_TOTAL_BYTES:
                raise ExchangeError("the archive would expand past the total size limit")
        by_name = {i.filename: i for i in infos}
        if MANIFEST not in by_name:
            raise ExchangeError("this is not a TraceHarness capture export: there is no manifest.json")
        try:
            manifest = loads_finite(_read_member(z, by_name[MANIFEST], MAX_MANIFEST_BYTES))
        except ValueError:
            raise ExchangeError("manifest.json is not valid JSON") from None
        if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
            raise ExchangeError("this is not a TraceHarness capture export (manifest format mismatch)")
        if manifest.get("version") not in KNOWN_VERSIONS:
            raise ExchangeError(f"unknown manifest version {manifest.get('version')!r}: this TraceHarness reads "
                                f"version {', '.join(map(str, sorted(KNOWN_VERSIONS)))}; update TraceHarness")
        listed = manifest.get("files")
        if not isinstance(listed, list):
            raise ExchangeError("manifest.json has no file list")
        entries: dict[str, dict] = {}
        for item in listed:
            if (not isinstance(item, dict) or not isinstance(item.get("path"), str)
                    or not isinstance(item.get("sha256"), str) or not isinstance(item.get("size"), int)
                    or isinstance(item.get("size"), bool)):
                raise ExchangeError("manifest.json has a malformed file entry")
            _check_member_name(item["path"])
            if item["path"] == MANIFEST:
                raise ExchangeError("manifest.json cannot list itself")
            if item["path"] in entries:
                raise ExchangeError(f"manifest.json lists {item['path']!r} twice")
            entries[item["path"]] = item
        extra = sorted(set(by_name) - set(entries) - {MANIFEST})
        if extra:
            raise ExchangeError(f"the archive holds a file the manifest does not list: {extra[0]!r}")
        missing = sorted(set(entries) - set(by_name))
        if missing:
            raise ExchangeError(f"the manifest lists a file the archive lacks: {missing[0]!r}")

        data: dict[str, bytes] = {}
        for name, item in entries.items():
            body = _read_member(z, by_name[name], MAX_ENTRY_BYTES)
            if len(body) != item["size"]:
                raise ExchangeError(f"{name!r} has {len(body)} bytes; the manifest says {item['size']}")
            if _sha(body) != item["sha256"].lower():
                raise ExchangeError(f"{name!r} does not match its sha256 in the manifest: the archive was "
                                    f"altered or damaged")
            data[name] = body

    runs: dict[str, dict] = {}
    for name, body in data.items():
        m = _MEMBER_RE.match(name)
        if m:
            runs.setdefault(m.group(1), {})[m.group(2)] = body
    declared_runs = manifest.get("runs")
    sources = {}
    if isinstance(declared_runs, list):
        for r in declared_runs:
            if isinstance(r, dict) and isinstance(r.get("run_id"), str):
                sources[r["run_id"]] = r.get("source")
    for run_id, files in runs.items():
        for need in REQUIRED:
            if need not in files:
                raise ExchangeError(f"run {run_id!r} has no {need}")
        try:
            summary = loads_finite(files["summary.json"].decode("utf-8"))
            seen = False
            for number, raw in enumerate(files["ledger.jsonl"].decode("utf-8").splitlines(), 1):
                if raw.strip():
                    check_ledger_line(loads_finite(raw), f"run {run_id!r} ledger line {number}", first=not seen)
                    seen = True
            files["patch.diff"].decode("utf-8") if "patch.diff" in files else None
            src = source_of(files["ledger.jsonl"])
        except (ValueError, UnicodeDecodeError):
            raise ExchangeError(f"run {run_id!r} has a summary or ledger that is not valid JSON") from None
        if not isinstance(summary, dict) or summary.get("run_id") != run_id:
            raise ExchangeError(f"run {run_id!r}: summary.json names a different run")
        check_summary_row(summary, f"run {run_id!r} summary.json")
        if src not in SOURCES or (run_id in sources and sources[run_id] != src):
            raise ExchangeError(f"run {run_id!r} has an unknown capture source {src!r}")
    index = []
    if INDEX in data:
        try:
            for raw in data[INDEX].decode("utf-8").splitlines():
                if raw.strip():
                    row = loads_finite(raw)
                    if not isinstance(row, dict) or row.get("run_id") not in runs:
                        raise ValueError
                    check_summary_row(row, f"an index.jsonl row for run {row['run_id']!r}")
                    index.append(row)
        except (ValueError, UnicodeDecodeError):
            raise ExchangeError("index.jsonl is malformed or names a run the archive does not hold") from None
    return {"manifest": manifest, "runs": runs, "index": index}


def _write_run(cap: str, run_id: str, files: dict) -> None:
    final = os.path.join(cap, run_id)
    stage = tempfile.mkdtemp(dir=cap, prefix=f"{run_id}.tmp-{os.getpid()}-")
    try:
        for name, body in files.items():
            fd = os.open(os.path.join(stage, name), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(body)
                f.flush()
                os.fsync(f.fileno())
        os.chmod(stage, 0o700)
        os.rename(stage, final)
    except BaseException:
        import shutil
        shutil.rmtree(stage, ignore_errors=True)
        raise


def import_archive(runs_root: str, path: str) -> dict:
    """Verify `path`, then write its runs into `runs_root`/captured. Returns
    {"imported": [run_id], "skipped": [run_id already present], "sources": [...]}."""
    from .backfill import _append_index
    verified = verify_archive(path)
    cap = os.path.join(runs_root, "captured")
    imported, skipped = [], []
    with CaptureLock(runs_root):
        os.makedirs(cap, exist_ok=True)
        if os.path.realpath(cap) != os.path.join(os.path.realpath(runs_root), "captured"):
            raise ExchangeError("the lab's captured folder is a link; refusing to write through it")
        for run_id, files in sorted(verified["runs"].items()):
            if os.path.lexists(os.path.join(cap, run_id)):
                skipped.append(run_id)
                continue
            _write_run(cap, run_id, files)
            imported.append(run_id)
        rows = [r for r in verified["index"] if r["run_id"] in set(imported)]
        if rows:
            _append_index(os.path.join(cap, "index.jsonl"), rows)
    return {"imported": imported, "skipped": skipped,
            "sources": sorted(verified["manifest"].get("sources") or [])}


# --- command line ---------------------------------------------------------------------------------

def _lab(args) -> str:
    if args.lab:
        os.environ["TRACEHARNESS_LAB"] = os.path.abspath(os.path.expanduser(args.lab))
    from traceharness.backend.paths import RUNS_ROOT      # after TRACEHARNESS_LAB, as everywhere here
    return RUNS_ROOT


def export_main(argv: list[str]) -> int:
    import argparse
    import sys
    os.environ.setdefault("PYTHON_COLORS", "0")
    p = argparse.ArgumentParser(
        prog="traceharness capture export", allow_abbrev=False,
        description="Write the captured sessions on this machine to one zip (redacted), to import on another.")
    p.add_argument("--out", required=True, metavar="FILE.zip", help="the archive to write (must not exist)")
    p.add_argument("--source", action="append", default=[], choices=SOURCES, metavar="NAME",
                   help=f"only this agent's sessions; repeatable ({', '.join(SOURCES)})")
    p.add_argument("--since", default="", metavar="DATE", help="only sessions that ended on or after this date")
    p.add_argument("--lab", default=None, metavar="DIR", help="lab root holding data/runs/")
    args = p.parse_args(argv)
    try:
        report = export_archive(_lab(args), args.out, sources=args.source, since=args.since)
    except ExchangeError as e:
        print(str(e), file=sys.stderr)
        return 2
    for run_id, reason in report["skipped"]:
        print(f"skip   {run_id}: {reason}", file=sys.stderr)
    print(f"exported {report['runs']} session(s), {report['bytes']} bytes, to {report['path']}")
    if not report["runs"]:
        print("the archive holds no sessions: nothing matched in this lab's captured/ folder", file=sys.stderr)
        return 1
    return 0


def import_main(argv: list[str]) -> int:
    import argparse
    import sys
    os.environ.setdefault("PYTHON_COLORS", "0")
    p = argparse.ArgumentParser(
        prog="traceharness capture import", allow_abbrev=False,
        description="Read a capture export zip into this lab's captured sessions. Nothing in the zip is run.")
    p.add_argument("archive", metavar="FILE.zip")
    p.add_argument("--lab", default=None, metavar="DIR", help="lab root holding data/runs/")
    args = p.parse_args(argv)
    return import_path(args.archive, _lab(args))


def import_path(archive: str, runs_root: str) -> int:
    import sys
    from .lock import CaptureLocked
    archive = os.path.abspath(os.path.expanduser(archive))
    if not os.path.isfile(archive):
        print(f"no such file: {archive}", file=sys.stderr)
        return 1
    try:
        report = import_archive(runs_root, archive)
    except ExchangeError as e:
        print(f"refused: {e}. Nothing was written.", file=sys.stderr)
        return 2
    except CaptureLocked as e:
        print(f"another capture writer holds the captured directory ({e}); wait for it, or pause the "
              f"watcher: traceharness capture --pause", file=sys.stderr)
        return 1
    print(f"imported {len(report['imported'])} session(s)"
          + (f", skipped {len(report['skipped'])} already in this lab" if report["skipped"] else "")
          + f" into {os.path.join(runs_root, 'captured')}")
    return 0
