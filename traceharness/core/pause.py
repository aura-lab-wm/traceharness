"""Human-in-the-loop pause: let a person approve, deny, edit, redirect or stop a running agent.

The Sentinel intervenes automatically; this module is the same hook point for a PERSON, the way
Inspect's tool-approval policies and AgentStepper's breakpoints let one step in. A harness opts in
with `HarnessConfig.pause` (default `{}`: never pauses):

  before_tools    [names]   pause before any pending call to one of these tools (an approver)
  at_step         [ints]    pause at these model calls (0-based, the `step` of the `chat` span)
  on_first_edit   bool      pause before the first write_file / edit_file of the run
  risk_at_least   float     pause when the Sentinel's verdict for the step is at least this risky
                            (needs the Sentinel enabled; without a verdict this never matches)
  timeout_s       number    how long to wait for a decision (default 900)
  on_timeout      str       "abort" (default) | "deny" | "approve"

ONE transport for both launch paths: a mailbox file `<run_dir>/decision.json`, written atomically
(tmp + os.replace) by whoever decides -- `traceharness decide` or the web API -- and polled by the
waiting run. The run records a `pause` span when it stops and an `intervention` span when a
decision lands; `live.describe` reads the pair from the ledger, so a waiting run reads `paused`,
not `abandoned`.

Decisions (the `decision` field):
  approve   run the pending calls as asked
  deny      do not run the pending call(s) (optional `call`: index of one call); the tool result
            tells the model a reviewer denied it, with the reviewer's `note`
  edit      replace the arguments of ONE pending call (`call`, `args`); the edited call goes
            through the same permission policy as any other call -- there is no bypass
  inject    approve, and add a user message (`message`) after the tool results, before the next call
  abort     end the run now (exit_reason `human_abort`)

Stdlib only.
"""
from __future__ import annotations

import json
import os
import re
import stat
import time
import unicodedata
from typing import Callable, Optional

DEFAULT_TIMEOUT_S = 900.0
DEFAULT_ON_TIMEOUT = "abort"
ON_TIMEOUT = ("abort", "deny", "approve")
DECISIONS = ("approve", "deny", "edit", "inject", "abort")
WHO = ("cli", "console")
#: How often a waiting run looks at the mailbox. Module-level so a test can shorten it.
POLL_S = 0.2
#: A pause older than its own deadline by this much is not waiting any more (the process died).
DEADLINE_SLACK_S = 60.0

MAX_FILE_BYTES = 256 * 1024
MAX_NOTE_CHARS = 2000
MAX_MESSAGE_CHARS = 8000
MAX_ARGS_BYTES = 64 * 1024
#: Bounds on what a `pause` span records, so the span stays far below live._TAIL_CHUNK (64 KiB).
_SPAN_MAX_CALLS = 8
_SPAN_MAX_VALUE = 2000
_SPAN_MAX_KEYS = 20

_KNOWN = {"before_tools", "at_step", "on_first_edit", "risk_at_least", "timeout_s", "on_timeout"}
_EDIT_TOOLS = ("write_file", "edit_file")


def normalize(cfg) -> Optional[dict]:
    """The validated pause config, or None when it never pauses. Raises ValueError on a bad one."""
    if not cfg:
        return None
    if not isinstance(cfg, dict):
        raise ValueError("pause must be an object")
    unknown = sorted(set(cfg) - _KNOWN)
    if unknown:
        raise ValueError(f"pause: unknown field(s) {unknown}; known: {sorted(_KNOWN)}")
    out = {"before_tools": [], "at_step": [], "on_first_edit": False, "risk_at_least": None,
           "timeout_s": DEFAULT_TIMEOUT_S, "on_timeout": DEFAULT_ON_TIMEOUT}
    bt = cfg.get("before_tools") or []
    if not isinstance(bt, (list, tuple)) or not all(isinstance(x, str) and x for x in bt):
        raise ValueError("pause.before_tools must be a list of tool names")
    out["before_tools"] = list(bt)
    at = cfg.get("at_step") or []
    if not isinstance(at, (list, tuple)) or not all(isinstance(x, int) and not isinstance(x, bool) and x >= 0 for x in at):
        raise ValueError("pause.at_step must be a list of non-negative integers")
    out["at_step"] = list(at)
    out["on_first_edit"] = bool(cfg.get("on_first_edit", False))
    r = cfg.get("risk_at_least")
    if r is not None:
        if isinstance(r, bool) or not isinstance(r, (int, float)) or not (0.0 <= float(r) <= 1.0):
            raise ValueError("pause.risk_at_least must be a number between 0 and 1")
        out["risk_at_least"] = float(r)
    t = cfg.get("timeout_s", DEFAULT_TIMEOUT_S)
    if isinstance(t, bool) or not isinstance(t, (int, float)) or not (0 < float(t) <= 86400):
        raise ValueError("pause.timeout_s must be a number of seconds in (0, 86400]")
    out["timeout_s"] = float(t)
    ot = cfg.get("on_timeout", DEFAULT_ON_TIMEOUT)
    if ot not in ON_TIMEOUT:
        raise ValueError(f"pause.on_timeout must be one of {list(ON_TIMEOUT)}")
    out["on_timeout"] = ot
    if not (out["before_tools"] or out["at_step"] or out["on_first_edit"] or out["risk_at_least"] is not None):
        return None            # only timeout settings: nothing to match, so never pauses
    return out


def matches(cfg: dict, step: int, pending: list, edits_so_far: int, verdict: Optional[dict]) -> list:
    """Reasons this step should pause (empty = do not pause)."""
    reasons = []
    names = [getattr(tc, "name", None) for tc in pending]
    hit = sorted({n for n in names if n in cfg["before_tools"]})
    if hit:
        reasons.append("before_tools: " + ", ".join(hit))
    if step in cfg["at_step"]:
        reasons.append(f"at_step: {step}")
    if cfg["on_first_edit"] and edits_so_far == 0 and any(n in _EDIT_TOOLS for n in names):
        reasons.append("on_first_edit")
    if cfg["risk_at_least"] is not None and verdict:
        risk = verdict.get("risk")
        if isinstance(risk, (int, float)) and float(risk) >= cfg["risk_at_least"]:
            reasons.append(f"risk_at_least: {float(risk):.2f} >= {cfg['risk_at_least']:g}")
    return reasons


# --------------------------------------------------------------------------- display safety
_BIDI = set("\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069")


def clean_text(s, keep_newlines: bool = True) -> str:
    """Strip terminal control and bidi-override characters (the ESC of an ANSI sequence, C0/C1 controls,
    the bidi formatting set) so a pending command cannot repaint a terminal or reorder what a reviewer
    reads. Tabs survive; line breaks survive too, or become a space with `keep_newlines=False` (a
    one-line display). The visible remainder of an ANSI sequence is left, harmless once the ESC is gone."""
    out = []
    for ch in str(s if s is not None else "").replace("\r\n", "\n"):
        if ch in ("\n", "\r", "\u2028", "\u2029"):
            out.append("\n" if keep_newlines else " ")
        elif ch == "\t":
            out.append(ch)
        elif ch in _BIDI or unicodedata.category(ch) in ("Cc", "Cf"):
            continue
        else:
            out.append(ch)
    return "".join(out)


# --------------------------------------------------------------------------- spans
def _trim(v, n=_SPAN_MAX_VALUE):
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[:n] + f"... [{len(s) - n} chars cut]"


def describe_pending(pending: list) -> list:
    out = []
    for i, tc in enumerate(pending[:_SPAN_MAX_CALLS]):
        args = getattr(tc, "arguments", None) or {}
        out.append({"index": i, "id": getattr(tc, "id", None), "name": getattr(tc, "name", None),
                    "arguments": {str(k): _trim(v) for k, v in list(args.items())[:_SPAN_MAX_KEYS]}})
    return out


# --------------------------------------------------------------------------- mailbox
def decision_path(run_dir: str) -> str:
    return os.path.join(run_dir, "decision.json")


def validate_decision(d, n_pending: int, step: Optional[int] = None) -> dict:
    """A normalised decision or ValueError. Writers call this before writing and the waiting run
    calls it again on what it reads: the file is a mailbox anybody who can write the directory can
    use, so the reader trusts nothing in it."""
    if not isinstance(d, dict):
        raise ValueError("decision must be a JSON object")
    kind = d.get("decision")
    if kind not in DECISIONS:
        raise ValueError(f"decision must be one of {list(DECISIONS)}")
    if step is not None and d.get("step") is not None and d.get("step") != step:
        raise ValueError(f"decision is for step {d.get('step')}, the run is waiting at step {step}")
    out = {"decision": kind, "step": d.get("step", step)}
    who = d.get("who", "cli")
    out["who"] = who if who in WHO else "cli"
    note = d.get("note") or ""
    if not isinstance(note, str):
        raise ValueError("note must be a string")
    out["note"] = note[:MAX_NOTE_CHARS]
    call = d.get("call")
    if call is not None:
        if isinstance(call, bool) or not isinstance(call, int) or not (0 <= call < n_pending):
            raise ValueError(f"call must be an index of a pending call (0..{max(n_pending - 1, 0)})")
        out["call"] = call
    if kind == "edit":
        if not n_pending:
            raise ValueError("nothing is pending to edit")
        args = d.get("args")
        if not isinstance(args, dict):
            raise ValueError("edit needs `args`: a JSON object that replaces the call's arguments")
        if len(json.dumps(args, ensure_ascii=False, default=str).encode("utf-8")) > MAX_ARGS_BYTES:
            raise ValueError("edited args are too large")
        out["args"] = args
        out["call"] = out.get("call", 0)
    if kind == "inject":
        msg = d.get("message")
        if not isinstance(msg, str) or not msg.strip():
            raise ValueError("inject needs a non-empty `message`")
        out["message"] = msg[:MAX_MESSAGE_CHARS]
    return out


def write_decision(run_dir: str, decision: dict) -> str:
    """Atomically put a decision in the run's mailbox (tmp + os.replace). Returns the path."""
    path = decision_path(run_dir)
    tmp = os.path.join(run_dir, f".decision.{os.getpid()}.{time.monotonic_ns()}.tmp")
    body = {**decision, "ts": time.time()}
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(body, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    return path


def _read_mailbox(run_dir: str):
    """The parsed mailbox content, or None when there is none (or it is not a plain file / not JSON).
    A symlink or an oversized file is refused so the mailbox cannot be used to read or exhaust anything."""
    path = decision_path(run_dir)
    # Open first, then check what was opened: a check by name followed by an open by name lets a
    # symlink or a FIFO be swapped in between (a FIFO would block the waiting run). O_NOFOLLOW refuses a
    # symlink, O_NONBLOCK keeps a FIFO from blocking the open, fstat checks the file actually opened.
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(path, flags)
    except FileNotFoundError:
        return None
    except OSError:
        _discard(path)          # a symlink (ELOOP) or anything else that is not a plain file
        return None
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_FILE_BYTES:
            _discard(path)
            return None
        with os.fdopen(fd, "rb") as f:
            fd = None
            return json.loads(f.read(MAX_FILE_BYTES).decode("utf-8"))
    except (OSError, ValueError):
        return None
    finally:
        if fd is not None:
            os.close(fd)


def _discard(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def clear_mailbox(run_dir: str) -> None:
    _discard(decision_path(run_dir))


def wait_for_decision(run_dir: str, step: int, n_pending: int, timeout_s: float, on_timeout: str,
                      should_stop: Optional[Callable[[], bool]] = None, poll: Optional[float] = None):
    """Block until a decision lands, the timeout passes, or `should_stop()` turns true.

    Returns (decision, who). `who` is "cli" | "console" for a person, "timeout" when the clock ran
    out (decision = the on_timeout policy), "cancel" when the job or the server was stopped (decision
    = abort). A mailbox file left over from before this pause was cleared when the pause began; one
    addressed to another step, or invalid, is deleted and ignored.
    """
    poll = POLL_S if poll is None else poll
    deadline = time.monotonic() + timeout_s
    while True:
        raw = _read_mailbox(run_dir)
        if raw is not None:
            try:
                dec = validate_decision(raw, n_pending, step)
            except ValueError:
                dec = None
            _discard(decision_path(run_dir))
            if dec is not None:
                return dec, dec["who"]
        if should_stop is not None and should_stop():
            return {"decision": "abort", "note": "the job was cancelled or the server is shutting down", "step": step}, "cancel"
        if time.monotonic() >= deadline:
            kind = {"approve": "approve", "deny": "deny"}.get(on_timeout, "abort")
            return {"decision": kind, "note": f"no decision within {timeout_s:g} s", "step": step}, "timeout"
        time.sleep(poll)


# --------------------------------------------------------------------------- reading state back
def pending_pause(ledger_path: str, now: Optional[float] = None) -> Optional[dict]:
    """The pause a run is waiting at right now -- its last ledger span is a `pause`, not yet past its
    deadline -- or None. Reads the last complete line only, the way live.describe does."""
    from . import live
    try:
        _, last = live._first_and_last_lines(ledger_path)
    except OSError:
        return None
    rec = live._parse(last) if last else None
    if not rec or rec.get("span") != "pause":
        return None
    now = time.time() if now is None else now
    dl = rec.get("deadline_ts")
    if isinstance(dl, (int, float)) and now > dl + DEADLINE_SLACK_S:
        return None
    return rec


def list_paused(runs_root: str, exclude=("captured",), now: Optional[float] = None, only_dir: Optional[str] = None) -> list:
    """Every run under runs_root that is waiting for a decision: {dir, run_id, task_id, harness_id,
    model, step, reason, pending, deadline_ts, timeout_s, on_timeout}. `runs_root` holds results
    directories, each holding run directories (the layout live.scan walks)."""
    from . import live
    out = []
    for row in live.scan(runs_root, recent=7 * 86400.0, exclude=exclude, now=now):
        if row.get("state") != "paused" or (only_dir is not None and row["dir"] != only_dir):
            continue
        rec = pending_pause(os.path.join(runs_root, row["dir"], row["run_id"], "ledger.jsonl"), now=now)
        if rec:
            out.append(paused_row(row["dir"], row["run_id"], row, rec))
    return out


def paused_row(dir_name: str, run_id: str, ident: dict, rec: dict) -> dict:
    return {"dir": dir_name, "run_id": run_id, "task_id": ident.get("task_id"), "harness_id": ident.get("harness_id"),
            "model": ident.get("model"), "step": rec.get("step"), "reason": rec.get("reason") or [],
            "pending": rec.get("pending") or [], "deadline_ts": rec.get("deadline_ts"),
            "timeout_s": rec.get("timeout_s"), "on_timeout": rec.get("on_timeout")}


class NotPaused(Exception):
    """The run is not waiting for a decision (finished, running, or its pause expired)."""


def submit_decision(run_dir: str, payload: dict, who: str) -> dict:
    """The one writer both the CLI and the web API use. Reads the run's ledger to confirm it is waiting
    right now, stamps the decision with the step it is waiting at (so a late decision can never answer
    a later pause), validates it against the pending calls, and puts it in the mailbox.

    Raises NotPaused when the run is not waiting, ValueError for a bad decision. Returns the decision."""
    if who not in WHO:
        raise ValueError(f"who must be one of {list(WHO)}")
    rec = pending_pause(os.path.join(run_dir, "ledger.jsonl"))
    if rec is None:
        raise NotPaused("this run is not waiting for a decision")
    step = rec.get("step")
    body = dict(payload or {})
    if body.get("step") is not None and body["step"] != step:
        raise ValueError(f"the run is waiting at step {step}, not {body['step']}")
    body["step"] = step
    body["who"] = who
    # every pending call the span lists; a longer list was cut at _SPAN_MAX_CALLS
    dec = validate_decision(body, len(rec.get("pending") or []), step)
    write_decision(run_dir, dec)
    return dec


def find_run_dir(target: str, roots: list) -> Optional[str]:
    """A run directory from a path (a directory holding ledger.jsonl) or a bare run id looked up as
    `<root>/<run_id>` and `<root>/<dir>/<run_id>` under each root. None when nothing matches."""
    if os.path.isfile(os.path.join(target, "ledger.jsonl")):
        return os.path.abspath(target)
    if os.sep in target or target in ("", ".", ".."):
        return None
    for root in roots:
        cands = [os.path.join(root, target)]
        try:
            cands += [os.path.join(d.path, target) for d in os.scandir(root) if d.is_dir(follow_symlinks=False)]
        except OSError:
            pass
        for c in cands:
            if os.path.isfile(os.path.join(c, "ledger.jsonl")) and not os.path.islink(c):
                return os.path.abspath(c)
    return None
