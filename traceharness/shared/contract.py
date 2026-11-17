"""The shared contracts (SPEC section 4) as constants: one port, one set of limits, one capability
table, one glossary.

Standard library only, and nothing from `traceharness.backend`: the command line imports this
before it has resolved the lab root, and `generate.py` builds the shared-sources bundle from it
without starting the app. The console reads the same values from the generated
`frontend/src/shared/shared-sources.json`. TraceHarness runs only on the user's machine (0.6.0): the
modes are the local console and a read-only export.
"""
from __future__ import annotations

SCHEMA = 1
HOST = "127.0.0.1"
PORT = 8765

#: A block prompt, in UTF-8 bytes (SPEC 4.6). `core/blocks.py` keeps its own copy, because it is a
#: compiler-oracle file and must not import this package; a test asserts the two are equal.
PROMPT_MAX_BYTES = 20_000
#: A fixed harness prompt sent to the runner, in UTF-8 bytes.
RUNNER_PROMPT_MAX_BYTES = 250_000
#: (lowest, highest) accepted for each run limit.
RUN_LIMITS = {"max_steps": (1, 200), "wall_time_seconds": (30, 3600), "max_cost_usd": (0.01, 100),
              "max_output_tokens": (1, 8192)}

#: The ten display classes, (name, viewport CSS px where it starts), in order. The same ten as
#: `frontend/src/rig/displayClasses.js` and the site's `tools/theme.py`.
DISPLAY_CLASSES = (
    ("small-phone", 0), ("phone", 360), ("large-phone", 480), ("tablet", 768), ("tablet-wide", 1024),
    ("laptop", 1280), ("desktop", 1440), ("full-hd", 1920), ("qhd", 2560), ("ultrawide", 3440),
)

#: Datasets the school replication package ships, in the order of `traceharness/school-package.json`.
SCHOOL_DATASETS = ("llma4se_live", "live", "real_swe_agent_500", "prerecorded_mock", "prerecorded_mock_weak",
                   "families_mock", "demo_mock", "captured_claude_code")

MODES = ("local", "export")

CAPABILITIES = (
    "data.read", "data.import", "data.live_events", "harness.compile", "harness.save", "run.local",
    "run.container", "run.native", "run.experiments", "judge.run", "capture.local",
    "settings.server_key", "assistant.model",
)

REASONS = ("ok", "export_read_only", "runner_not_ready", "not_configured", "unavailable")

#: Capabilities that need the local runner (`traceharness runner setup`, Docker). The table says "ok" for the
#: local console; the backend reports "runner_not_ready" at runtime until the runner is set up.
RUNNER = ("run.container", "run.native", "run.experiments")

#: CAPABILITY_TABLE[capability][mode] -> reason; "ok" means available (SPEC 4.2).
CAPABILITY_TABLE = {cid: {"local": "ok", "export": "ok" if cid == "data.read" else "export_read_only"}
                    for cid in CAPABILITIES}

#: One sentence per reason that is not "ok", with {what}, {command} and {url} to fill.
MESSAGES = {
    "export_read_only": "{what} is not available in a read-only export. Start the local console: {command}",
    "runner_not_ready": "{what} needs the local runner. Run traceharness runner setup (Docker required).",
    "not_configured": "{what} is not set up on this computer.",
    "unavailable": "{what} is not available right now.",
}

#: Where saved harnesses live in each mode.
LIBRARY = {
    "local": {"available": True, "store": "local", "label": "this computer"},
    "export": {"available": False, "store": None, "label": None},
}

#: The canonical words (SPEC 4.4).
LABELS = {
    "console": "console", "local_console": "local console", "console_link": "Console",
    "harnesses": "Harnesses", "fixed": "Fixed harnesses", "minimal": "Minimal harness",
    "plain_editor": "Plain harness editor", "capture_local": "Session capture",
    "capture_member": "Capture computers", "runner": "runner", "account": "Account", "admin": "Admin",
}

#: Retired phrases, exact and case-sensitive, each with the word to use instead. `scope` is "site"
#: for a phrase only the site still carries, "all" otherwise.
RETIRED = (
    {"phrase": "8742", "use": "8765", "scope": "all"},
    {"phrase": "8794", "use": "8765", "scope": "site"},
    {"phrase": "Simple harness editor", "use": "Plain harness editor", "scope": "all"},
    {"phrase": "simple harness editor", "use": "plain harness editor", "scope": "all"},
    {"phrase": "Shallow harnesses", "use": "Harnesses", "scope": "all"},
    {"phrase": "shallow harness editor", "use": "plain harness editor", "scope": "all"},
    {"phrase": "Full workbench", "use": "Console", "scope": "all"},
    {"phrase": "Minimal wizard", "use": "Minimal harness", "scope": "all"},
    {"phrase": "local workbench", "use": "local console", "scope": "all"},
    {"phrase": "Local workbench", "use": "Local console", "scope": "all"},
    {"phrase": "the local app", "use": "the local console", "scope": "all"},
    {"phrase": "the live app", "use": "the local console", "scope": "all"},
    {"phrase": "local lab", "use": "local console", "scope": "all"},
)

#: sessionStorage draft keys (SPEC 4.5): prefix + name.
DRAFT_PREFIX_MEMBER = "traceharness.shallow.member.{scope}."
DRAFT_PREFIX_LOCAL = "traceharness.shallow."
DRAFT_NAMES = ("fixed", "answers", "customize", "customize-draft", "composer", "composer-source", "apply")

#: The conflict-safe save (SPEC 4.5).
SAVE_PROTOCOL = {"version": 1, "fixed": "if_hash|if_absent", "minimal": "content-addressed"}

#: The public compiler sources the Worker's compiler is checked against (repository-relative).
ORACLE_FILES = (
    "traceharness/__init__.py", "traceharness/shallow/__init__.py", "traceharness/shallow/wizard.py",
    "traceharness/core/__init__.py", "traceharness/core/blocks.py", "traceharness/core/harness.py",
    "traceharness/core/tools.py", "traceharness/core/ledger.py", "traceharness/core/grader.py",
    "traceharness/core/providers.py",
)


def local_app() -> dict:
    """How to start the local console, and where it answers."""
    return {"command": f"python -m traceharness --host {HOST} --port {PORT}",
            "url": f"http://{HOST}:{PORT}", "port": PORT}


def environment(mode: str, reasons: dict | None = None) -> dict:
    """The SPEC 4.2 environment answer for `mode`: what this console can do here, and why not.

    `reasons` lets the backend report a runtime state that the static table cannot know, e.g.
    {"run.native": "runner_not_ready"} before `traceharness runner setup` has run."""
    if mode not in MODES:
        raise ValueError(f"unknown mode {mode!r}: expected one of {', '.join(MODES)}")
    reasons = reasons or {}
    unknown = set(reasons) - set(CAPABILITIES) or {r for r in reasons.values() if r not in REASONS}
    if unknown:
        raise ValueError(f"unknown capability or reason: {sorted(unknown)}")
    from traceharness.__main__ import __version__   # deferred: __main__ imports this module

    def reason(cid):
        base = CAPABILITY_TABLE[cid][mode]
        return reasons.get(cid, base) if base == "ok" else base

    return {
        "schema": SCHEMA,
        "mode": mode,
        "package_version": __version__,
        "local_app": local_app(),
        "library": dict(LIBRARY[mode]),
        "capabilities": {cid: {"available": reason(cid) == "ok", "reason": reason(cid)} for cid in CAPABILITIES},
    }


def availability(name: str) -> list[str]:
    """Where a dataset is published: ["school"] when the school package ships it, else []."""
    return ["school"] if name in SCHOOL_DATASETS else []
