"""Trajectory fields of one run, for the run page, run_get and the task view.

    trajectory_fields(spans, patch, estimated) -> ({index in spans: per-call fields}, run-level fields)

A span with no phase (the lab's runner writes none) takes its tool's at read time (phases.span_phases).

Per execute_tool span:
  letter     the patterns letter (phases.call_letter)
  cut        {cut: true, shown, total}: the output hit the observation limit. Seen from a flag the importer
             wrote (output_truncated), a harness's cut marker in the preview, or output_chars over a limit the
             harness declared (an imported harness's observation_chars is only the largest output it saw).
             shown is output_chars (null when not recorded); total is null, no source states it on the span.
  repeat_of  {step, seq} of the first identical call (core/repeats.py key), when this call repeats one. A match
             on arguments the ledger clipped (map_tool ends them with " …") is not one: it is counted apart

Run level, for every run with a tool call:
  after_fix     the last edit to a file of the final patch that existed before the run (fix_targets: a file the run
                created is not the fix, unless the patch only creates files); an edit is an edit_file / write_file,
                a sed -i, git apply or patch (_fix_path): {fix_step, fix_seq, fix_call, path, calls_after, calls,
                share_after, tokens_after, tokens, submit_only}, or {reason}. Counted in MODEL calls
                (tokens.run_profile's grouping), a call that only submits left out. calls_after are the calls
                after the one that wrote the fix (fix_call, 1-based); tokens and tokens_after are the generated
                tokens of `calls` and of `calls_after` (null when any of them is unknown); submit_only the model calls
                left out because they only submit or run the submission protocol (PROTOCOL: git diff > patch.txt,
                cat patch.txt, the COMPLETE_TASK echo); calls + submit_only is all the run's model calls.
  first_lookup  {step, seq, rule}: the first call whose phase is lookup (step null when there is none)
  repeats       {n, clipped, calls, definition}: exact repeats, and matches on clipped arguments

fix_step and first_lookup.step are 1-based positions among the run's tool calls; seq is the span's ledger seq.

    call_axis(spans, run fields) -> the run on one axis of model calls, for the task view
"""
from __future__ import annotations

import re
from typing import Optional

from . import repeats as R
from .patch_kinds import patch_kinds
from .phases import call_letter, span_phases
from .tokens import model_call_of, run_profile

#: where a harness cut a tool's output: OpenHands, SWE-agent, mini-swe-agent, this lab
CUT_MARKER = re.compile(r"<response clipped>|\[\.\.\. Observation truncated due to length \.\.\.\]|"
                        r"The output of your last command was too long|<elided_chars>|chars truncated by harness")
LOOKUP_RULE = ("the TraceHarness phase rule (core/phases.py): a fetch from an outside host; "
               "a source that lists its own lookups can be more exact")
EDIT_TOOLS = ("edit_file", "write_file")
#: a shell command that writes a file in place: sed -i (it names the file), git apply and patch (the diff they apply
#: may not name it)
SED_IN_PLACE = re.compile(r"\bsed\s+(?:-[^\s]*\s+)*?(?:-[a-zA-Z]*i|--in-place)")
APPLY = re.compile(r"\bgit\s+apply\b(?![^\n;&|]*--(?:check|stat|numstat|summary)\b)|(?:^|[\s;&|(])patch\s+(?:-{1,2}\w|<)")
#: an edit_file "path" an importer misread from a shell command ("=", "cd", "{}"): not a file name
NOT_A_PATH = re.compile(r"^(?:cd|tail|head|cat|echo|python3?|sed|ls|grep|find|git|rm|mv|cp|bash|sh)$|[^\w./~+-]")
#: the submission protocol, steps that hand the patch in rather than work on it: mini-swe-agent's
#: git diff > patch.txt, cat patch.txt and its COMPLETE_TASK echo
PROTOCOL = re.compile(r"COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT|git diff[^\n]*>\s*patch\.txt|cat\s+patch\.txt")


def with_phases(spans: list) -> list:
    """`spans`, each execute_tool span with a phase: its own, else its tool's (new dicts; the input is not changed)."""
    return [{**s, "phase": p} if p and not s.get("phase") else s for s, p in zip(spans, span_phases(spans))]


def trajectory_fields(spans: list, patch: str = "", estimated: bool = False) -> tuple[dict, dict]:
    spans = with_phases(spans)
    start = next((s for s in spans if s.get("span") == "invoke_agent" and s.get("status") == "start"), {})
    harness = start.get("harness") if isinstance(start.get("harness"), dict) else {}
    calls = [(i, s) for i, s in enumerate(spans) if s.get("span") == "execute_tool"]
    per: dict = {}
    for i, s in calls:
        c = cut_of(s, harness)
        if c:
            per[i] = {"cut": c}
    if not calls:
        return per, {}
    rep = R.series([s for _, s in calls])
    exact = clipped = 0
    for k, (i, s) in enumerate(calls):
        extra = {}
        if s.get("phase"):
            extra["letter"] = call_letter(s, s["phase"])
        first = rep["repeat_of"][k]
        if first != -1 and _clipped(s):
            clipped += 1
        elif first != -1:
            exact += 1
            extra["repeat_of"] = {"step": first + 1, "seq": calls[first][1].get("seq")}
        if extra:
            per[i] = {**per.get(i, {}), **extra}
    run = {"after_fix": after_fix(spans, [s for _, s in calls], patch, estimated),
           "first_lookup": first_lookup([s for _, s in calls]),
           "repeats": {"n": exact, "clipped": clipped, "calls": len(calls), "definition": R.DEFINITION}}
    return per, run


def _clipped(span: dict) -> bool:
    return any(isinstance(v, str) and v.endswith(" …") for v in (span.get("args") or {}).values())


def cut_of(span: dict, harness: dict) -> Optional[dict]:
    shown = span.get("output_chars")
    shown = shown if isinstance(shown, int) and not isinstance(shown, bool) else None
    limit = 0 if "fingerprint" in harness else harness.get("observation_chars")
    over = shown is not None and isinstance(limit, int) and limit > 0 and shown > limit
    if span.get("output_truncated") is True or over or CUT_MARKER.search(str(span.get("result_preview") or "")):
        return {"cut": True, "shown": shown, "total": None}
    return None


def first_lookup(calls: list) -> dict:
    k = next((k for k, s in enumerate(calls) if s.get("phase") == "lookup"), None)
    return {"step": None if k is None else k + 1, "seq": None if k is None else calls[k].get("seq"), "rule": LOOKUP_RULE}


def _is_submit(span: dict) -> bool:
    """The submit, or a step of the submission protocol (PROTOCOL)."""
    if span.get("phase") == "submit" or span.get("gen_ai.tool.name") == "submit":
        return True
    return span.get("gen_ai.tool.name") == "bash" and bool(PROTOCOL.search(str((span.get("args") or {}).get("command") or "")))


def _named(text: str, files: list) -> Optional[str]:
    """The first of `files` that `text` names, else None."""
    return next((f for f in files if f in text), None)


def _fix_path(span: dict, files: list) -> Optional[str]:
    """The patch file this call wrote ("" for a git apply / patch that names none), or None when it wrote none of
    them: an edit_file / write_file to one, an edit whose misread path (NOT_A_PATH) hides a command that names one,
    a sed -i on one, or a git apply / patch."""
    if span.get("status") in ("error", "blocked"):
        return None
    args = span.get("args") or {}
    if span.get("gen_ai.tool.name") in EDIT_TOOLS:
        path = str(args.get("path") or "")
        if _in_patch(path, files):
            return path
        if not path or NOT_A_PATH.search(path):
            return _named(" ".join(str(v) for k, v in args.items() if k != "path"), files)
        return None
    if span.get("gen_ai.tool.name") == "bash":
        cmd = str(args.get("command") or "")
        if PROTOCOL.search(cmd):
            return None
        if SED_IN_PLACE.search(cmd):
            return _named(cmd, files)
        if APPLY.search(cmd):
            return _named(cmd, files) or ""
    return None


def _in_patch(path: str, files: list) -> bool:
    return bool(path) and any(path == f or path.endswith("/" + f) for f in files)


def fix_targets(patch: str) -> list:
    """The patch's files the fix can be an edit to: the ones that existed before the run (a file the run created, such
    as a scratch script left in the patch, is not the fix). All of them when the patch only creates files."""
    from traceharness.backend.importers.common import patch_files
    files = patch_files(patch or "")
    kinds = patch_kinds(patch or "")
    return [f for f in files if kinds.get(f) != "created"] or files


def after_fix(spans: list, calls: list, patch: str, estimated: bool = False) -> dict:
    files = fix_targets(patch)
    if not files:
        return {"reason": "no patch"}
    fix = fix_path = None
    for k, s in enumerate(calls):
        p = _fix_path(s, files)
        if p is not None:
            fix, fix_path = k, p
    if fix is None:
        return {"reason": "no edit to a patch file detected"}
    at, n = model_call_of(spans, estimated)
    owner = [at[i] for i, s in enumerate(spans) if s.get("span") == "execute_tool"]
    tools_of: dict = {}
    for k, m in enumerate(owner):
        tools_of.setdefault(m, []).append(calls[k])
    work = [m for m in range(n) if not (tools_of.get(m) and all(_is_submit(t) for t in tools_of[m]))]
    after = [m for m in work if m > owner[fix]]
    generated = [c["generated"] for c in run_profile(spans, estimated=estimated)["calls"]]
    return {"fix_step": fix + 1, "fix_seq": calls[fix].get("seq"), "fix_call": owner[fix] + 1, "path": fix_path,
            "calls_after": len(after), "calls": len(work), "share_after": len(after) / len(work) if work else None,
            "tokens_after": _generated(generated, n, after), "tokens": _generated(generated, n, work), "submit_only": n - len(work)}


def _generated(generated: list, n: int, which: list) -> Optional[float]:
    """The generated tokens of model calls `which`; None when any is unknown or the profile has other calls."""
    if len(generated) != n or any(generated[m] is None for m in which):
        return None
    return sum(generated[m] for m in which)


def call_axis(spans: list, run: dict, estimated: bool = False) -> dict:
    """The run on one axis of MODEL calls (the unit of the task view's token chart and of after_fix): {calls, steps,
    phases: [[phase, n], ...] run-length over the calls (a call's phase is its first reply's, else its first tool
    call's; None when neither records one), fix_at, lookup_at: the calls holding the fix and the first lookup (None when
    there is none), first_step: the run page step (views/steps.js: one per model reply) each call starts at}. Events
    before the first reply belong to the first call."""
    spans = with_phases(spans)
    at, n = model_call_of(spans, estimated)
    call_of = {s.get("seq"): at[i] for i, s in enumerate(spans)}
    reply: list = [None] * n
    tool: list = [None] * n
    first_step: list = []
    steps = 0
    for i, s in enumerate(spans):
        m = at[i]
        if s.get("span") == "chat":
            steps += 1
            if len(first_step) == m:
                first_step.append(steps)
                reply[m] = s.get("phase")
        elif s.get("span") == "execute_tool" and n and tool[m] is None and s.get("phase"):
            tool[m] = s["phase"]
    runs: list = []
    for p in (reply[m] or tool[m] for m in range(n)):
        if runs and runs[-1][0] == p:
            runs[-1][1] += 1
        else:
            runs.append([p, 1])
    fix = (run.get("after_fix") or {}).get("fix_seq")
    look = (run.get("first_lookup") or {}).get("seq")
    place = lambda seq: None if seq is None or seq not in call_of or not n else call_of[seq] + 1   # noqa: E731
    return {"calls": n, "steps": steps, "phases": runs, "fix_at": place(fix), "lookup_at": place(look), "first_step": first_step}
