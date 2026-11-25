"""What a dataset is, in plain words, for the dataset picker and its hover cards.

    describe(runs_root, name, rows) -> {display_name, summary, description, kind, bundled, source, harness_notes}

Computed only from files that already exist, never invented:
  * a dataset folder's own dataset.json, or the front matter of its README.md (OWN_FILES), says its display_name,
    summary and description as whoever made the dataset wrote them; each field it gives wins over the ones below;
  * a dataset that ships with TraceHarness quotes its row of README.md's "Included datasets" table (BUNDLED;
    tests_agentlab/test_dataset_meta.py fails when the quote and the README differ);
  * a Hugging Face import quotes its provenance.json (title, description, attribution, licence, date);
  * an import or a capture names its adapter and source file from the first span of its first run, and keeps
    the import notes that span carries;
  * every harness's notes (and, for runs the lab ran itself, its step limit, tool count and policy) come from
    the first span of the first run of that harness, so they are the notes the runs were recorded under.
What no file says stays None; the console shows "no description yet".

`kind` is one of: recorded (the lab's runner, real models), mock (scripted agents), public (a published
dataset), imported (runs you imported), captured (sessions captured on this computer), demo (a capture or an
import that ships with TraceHarness).
"""
from __future__ import annotations

import json
import os
from typing import Iterable, Optional

#: The README row a dataset's description quotes, word for word (markdown removed); `summary` is a quote of it
#: short enough for one line of the picker; `display_name` says the same in a few plain words; `runs` is the row's
#: Runs column, and the row is used only for a folder that holds exactly that many runs.
DOC = "README.md › Included datasets"
BUNDLED: dict[str, dict] = {
    "study_v04": {
        "runs": 3240,
        "display_name": "Harness study v04",
        "summary": "Gemini 2.5 Flash-Lite, GPT-5.6 Luna and Qwen3.8 27B × nine harnesses",
        "description": "Real. Gemini 2.5 Flash-Lite, GPT-5.6 Luna and Qwen3.8 27B × nine harnesses (baseline, reprompt, "
                       "long_output, short_history, short_observations, no_test_tool, terse_prompt, tight_budget, permissive) "
                       "× 24 tasks (8 core + 16 extended) × 5 repeats, collected through OpenRouter on November 14, 2026 "
                       "($7.75). Every run records the upstream host that served it (served_by). In the repository only, "
                       "not in the school package.",
    },
    "llma4se_live": {
        "runs": 1248,
        "display_name": "Lab runs, four models",
        "summary": "Four models (Gemini 2.5 Flash-Lite, Gemini 3.8 Flash, GPT-5.6 Luna, Qwen3.8 27B) × six harnesses × 8 tasks",
        "description": "Real. Four models (Gemini 2.5 Flash-Lite, Gemini 3.8 Flash, GPT-5.6 Luna, Qwen3.8 27B) × six "
                       "harnesses × 8 tasks, collected for this lab through OpenRouter. Default for exercises 1–6 and 8.",
    },
    "live": {
        "runs": 576,
        "display_name": "Lab runs, three more models",
        "summary": "Claude Haiku 4.5, Gemini 2.5 Flash, GPT-5-mini × eight harnesses × 8 tasks",
        "description": "Real. Claude Haiku 4.5, Gemini 2.5 Flash, GPT-5-mini × eight harnesses × 8 tasks, collected for "
                       "this lab through OpenRouter. Second input to exercise 8.",
    },
    "real_swe_agent_500": {
        "runs": 500,
        "display_name": "SWE-agent on GitHub issues",
        "summary": "SWE-agent (Llama 8B / 70B) on 30 GitHub issues",
        "description": "Real, third-party. SWE-agent (Llama 8B / 70B) on 30 GitHub issues, from "
                       "nebius/SWE-agent-trajectories (CC-BY-4.0). Used by ex7 --offline.",
    },
    "prerecorded_mock": {
        "runs": 480,
        "display_name": "Mock agent, six harnesses",
        "summary": "Mock model × six harnesses × 8 tasks — deterministic baseline identical on every machine.",
        "description": "Mock model × six harnesses × 8 tasks — deterministic baseline identical on every machine.",
    },
    "prerecorded_mock_weak": {
        "runs": 160,
        "display_name": "Weaker mock agent",
        "summary": "Weaker mock model — the 2 × 2 mock version of exercise 8.",
        "description": "Weaker mock model — the 2 × 2 mock version of exercise 8.",
    },
    "families_mock": {
        "runs": 80,
        "display_name": "Two mock models",
        "summary": "Two mock models × four harnesses × 5 tasks.",
        "description": "Two mock models × four harnesses × 5 tasks.",
    },
    "demo_mock": {
        "runs": 24,
        "display_name": "Compact mock demo",
        "summary": "Compact mock demonstration.",
        "description": "Compact mock demonstration.",
    },
    "captured_claude_code": {
        "runs": 1,
        "display_name": "One captured Claude Code session",
        "summary": "One Claude Code session (Claude Sonnet 5, 28 steps) implementing results_scope.py and its test",
        "description": "Real, captured. One Claude Code session (Claude Sonnet 5, 28 steps) implementing results_scope.py "
                       "and its test in this repository (nine test runs, tested before exit). Recorded by the capture "
                       "pipeline with machine paths normalized to /workspace/traceharness: an organic session with no "
                       "oracle, one repeat, and an unchosen harness.",
    },
}

KINDS = ("recorded", "mock", "public", "imported", "captured", "demo")
#: the longest first ledger line read (a start span with its system prompt is far below this); a longer one is not parsed
MAX_LINE = 1 << 20
#: the longest text taken from a file into a row (a note or a description), so one odd file cannot swell the listing
MAX_TEXT = 600
_PROVENANCE_KEYS = ("dataset", "url", "attribution", "license", "fetched_at")
#: the files a dataset folder can describe itself in, first found wins, and the fields read from them
OWN_FILES = ("dataset.json", "README.md")
OWN_KEYS = ("display_name", "summary", "description")
#: a YAML block scalar's mark: its text is on the lines below, which this reader does not take, so the key is skipped
BLOCK_MARKS = (">", "|", ">-", "|-", ">+", "|+")
#: the most of a README.md read for its front matter
MAX_README = 64 * 1024


def _text(v) -> Optional[str]:
    """A non-empty string cut to MAX_TEXT, else None: a file's value is data, never trusted to be a string."""
    if not isinstance(v, str) or not v.strip():
        return None
    s = " ".join(v.split())
    return s if len(s) <= MAX_TEXT else s[:MAX_TEXT - 1].rstrip() + "…"


def _positive_int(v) -> Optional[int]:
    return v if isinstance(v, int) and not isinstance(v, bool) and v > 0 else None


def kind_of(providers: Iterable[str], models: Iterable[str], *, hf: bool, bundled: bool) -> str:
    """The dataset's kind from what its runs say they are (see the module docstring)."""
    providers = [str(p) for p in providers if p]
    models = [str(m) for m in models if m]
    if (providers and all(p == "mock" for p in providers)) or (models and all(m.startswith("mock") for m in models)):
        return "mock"
    if any(p.startswith("capture:") for p in providers):
        kind = "captured"
    elif hf or any(p == "import:huggingface" or ("/" in p and ":" not in p) for p in providers):
        return "public"
    elif any(p.startswith("import:") for p in providers):
        kind = "imported"
    else:
        return "recorded"
    return "demo" if bundled else kind


def _provenance(dirpath: str) -> Optional[dict]:
    """The provenance.json a Hugging Face import writes (`source` "huggingface"), else None."""
    try:
        with open(os.path.join(dirpath, "provenance.json"), encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) and doc.get("source") == "huggingface" else None


def _front_matter(text: str) -> dict:
    """`key: value` lines between a leading `---` and the next `---` (simple YAML front matter; quotes stripped)."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    out = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return out
        key, sep, value = line.partition(":")
        v = value.strip()
        if sep and key.strip() in OWN_KEYS and v not in BLOCK_MARKS:
            out[key.strip()] = v[1:-1] if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'" else v
    return {}                                      # no closing ---: not front matter


def _own_description(dirpath: str) -> tuple[dict, Optional[str]]:
    """({display_name, summary, description} that the dataset's own file gives, file name), or ({}, None)."""
    for fn in OWN_FILES:
        try:
            with open(os.path.join(dirpath, fn), encoding="utf-8") as f:
                raw = f.read(MAX_README)
            doc = json.loads(raw) if fn.endswith(".json") else _front_matter(raw)
        except (OSError, ValueError):
            continue
        got = {k: _text(doc.get(k)) for k in OWN_KEYS} if isinstance(doc, dict) else {}
        got = {k: v for k, v in got.items() if v}
        if got:
            return got, fn
    return {}, None


def _first_span(dirpath: str, run_id: str) -> Optional[dict]:
    """The first line of a run's ledger, or None when it is missing or unreadable."""
    if not isinstance(run_id, str) or not run_id or "/" in run_id or run_id in (".", ".."):
        return None
    try:
        with open(os.path.join(dirpath, run_id, "ledger.jsonl"), encoding="utf-8") as f:
            line = f.readline(MAX_LINE)
        span = json.loads(line) if line.strip() else None
    except (OSError, ValueError):
        return None
    return span if isinstance(span, dict) else None


def _first_runs(rows: Iterable[dict]) -> dict[str, str]:
    """{harness_id: the smallest run_id of that harness}: one stable run speaks for each harness."""
    out: dict[str, str] = {}
    for r in rows:
        h, rid = r.get("harness_id"), r.get("run_id")
        if isinstance(h, str) and isinstance(rid, str) and (h not in out or rid < out[h]):
            out[h] = rid
    return out


def _harness_entry(span: dict, lab_run: bool) -> Optional[dict]:
    h = span.get("harness")
    if not isinstance(h, dict):
        return None
    notes = _text(h.get("notes"))
    if notes is None:
        return None
    entry = {"notes": notes}
    # an import writes 0 / "" / [] for what its source does not record: only the lab's own runs carry real limits
    if lab_run:
        steps = _positive_int(h.get("max_steps"))
        if steps is not None:
            entry["max_steps"] = steps
        if isinstance(h.get("tools"), list) and h["tools"]:
            entry["tools"] = len(h["tools"])
        policy = _text(h.get("policy"))
        if policy:
            entry["policy"] = policy
    return entry


def _first_sentence(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    for i, ch in enumerate(s):
        if ch == "." and (i + 1 == len(s) or s[i + 1] == " "):
            return s[:i + 1]
    return s


def describe(runs_root: str, name: str, rows: list[dict]) -> dict:
    """The plain description of one results directory, from its files (see the module docstring); what the folder's
    own dataset.json or README.md front matter says wins, field by field."""
    out = _computed(runs_root, name, rows)
    own, fn = _own_description(os.path.join(runs_root, name))
    if not own:
        return out
    if "description" in own and "summary" not in own:
        own["summary"] = _first_sentence(own["description"])
    return {**out, **own, "source": {**(out["source"] or {}), "doc": fn}}


def _computed(runs_root: str, name: str, rows: list[dict]) -> dict:
    d = os.path.join(runs_root, name)
    providers = sorted({str(r.get("provider")) for r in rows if r.get("provider")})
    models = sorted({str(r.get("model")) for r in rows if r.get("model")})
    prov = _provenance(d)
    # the README row speaks for the dataset it counts: a folder of the same name holding other runs (your own runs
    # added to `live`, or a dataset named like a bundled one) gets no borrowed description
    doc = BUNDLED.get(name) if BUNDLED.get(name, {}).get("runs") == len(rows) else None
    kind = kind_of(providers, models, hf=prov is not None, bundled=doc is not None)
    lab_run = not any(p.startswith(("import:", "capture:")) or "/" in p for p in providers)

    first = _first_runs(rows)
    spans = {h: _first_span(d, rid) for h, rid in sorted(first.items())}
    harness_notes = {}
    for h, span in spans.items():
        entry = _harness_entry(span, lab_run) if span else None
        if entry:
            harness_notes[h] = entry

    out = {"display_name": None, "summary": None, "description": None, "kind": kind, "bundled": doc is not None,
           "source": None, "harness_notes": harness_notes}
    if doc:
        out.update(display_name=doc["display_name"], summary=doc["summary"], description=doc["description"],
                   source={"doc": DOC})
        return out
    if prov:
        title = _text(str(prov.get("attribution") or "").split(",")[0]) if prov.get("attribution") else None
        ds = _text(prov.get("dataset"))
        description = _text(prov.get("description"))
        out.update(display_name=title or (ds.split("/")[-1] if ds else None), summary=_first_sentence(description),
                   description=description,
                   source={**{k: _text(prov.get(k)) for k in _PROVENANCE_KEYS if _text(prov.get(k))},
                           **{k: prov[k] for k in ("n", "n_imported") if _positive_int(prov.get(k))}} or None)
        return out
    if kind in ("imported", "captured"):
        span = next((s for s in spans.values() if s), None) or {}
        adapter, file = _text(span.get("import_source")), _text(span.get("source_path"))
        notes = _text((span.get("harness") or {}).get("notes")) if isinstance(span.get("harness"), dict) else None
        fp = (span.get("harness") or {}).get("fingerprint") if isinstance(span.get("harness"), dict) else None
        agent = _text(fp.get("agent")) if isinstance(fp, dict) else None
        verb = "Imported" if kind == "imported" else "Captured"
        if adapter and file:
            out["summary"] = f"{verb} with the {adapter} adapter from {file}."
            out["description"] = out["summary"]
        if len(models) == 1 and agent:
            out["display_name"] = f"{models[0]} with {agent}"
        out["source"] = {k: v for k, v in (("adapter", adapter), ("file", file), ("notes", notes)) if v} or None
    return out
