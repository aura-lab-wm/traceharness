"""Write the shared-sources bundle (SPEC 4.1): the one file the console and the package agree on.

    python -m traceharness.shared.generate            # writes both copies
    python -m traceharness.shared.generate --check    # exit 1, naming the stale file
    python -m traceharness.shared.generate --stdout   # print the text (the site's sync reads this)

The two copies are byte-identical: `traceharness/shared/shared-sources.json` ships in the wheel, and
`traceharness/frontend/src/shared/shared-sources.json` is compiled into the console. Every value comes
from the source that owns it: the constants from `contract`, the colour tokens from the console's
`index.css`, the capture sources from `capture/sources.py`, the fixed and minimal harnesses from
`shallow/`, and a SHA-256 of each compiler-oracle file. Standard library only.
"""
from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import sys

from . import contract

#: The directory that holds the `traceharness` package (a checkout's root, or site-packages).
BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
#: The two copies, relative to BASE.
TARGETS = ("traceharness/shared/shared-sources.json", "traceharness/frontend/src/shared/shared-sources.json")

_TOKEN = re.compile(r"--rig-([a-z0-9-]+)-(d|l)\s*:\s*([^;]+);")
_SOURCES = re.compile(r"^SOURCES = (\(.*?\))$", re.M)
_AGENT_KEYS = ("id", "name", "cap_bytes", "max_steps", "tools", "policy", "prompt")


def _read(rel: str) -> str:
    with open(os.path.join(BASE, rel), encoding="utf-8") as f:
        return f.read()


def _sha256_file(rel: str) -> str:
    with open(os.path.join(BASE, rel), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _compact(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def tokens() -> dict:
    """`--rig-<name>-d|-l` from the console's index.css; `cx-*` names go to `console` (dark value)."""
    out = {"dark": {}, "light": {}, "console": {}}
    for name, side, value in _TOKEN.findall(_read("traceharness/frontend/src/index.css")):
        if name.startswith("cx-"):
            if side == "d":
                out["console"][name] = value.strip()
        else:
            out["dark" if side == "d" else "light"][name] = value.strip()
    return out


def capture_sources() -> list[str]:
    m = _SOURCES.search(_read("traceharness/capture/sources.py"))
    if not m:
        raise RuntimeError("traceharness/capture/sources.py has no `SOURCES = (...)` line")
    return sorted(ast.literal_eval(m.group(1)))


def shallow() -> dict:
    from traceharness.shallow import catalog, wizard
    agents = [{k: card[k] for k in _AGENT_KEYS} for card in catalog.catalog()]
    questions = [{"id": q["id"], "prompt": q["prompt"], "recommended": q["recommended"],
                  "options": [list(option) for option in q["options"]]} for q in wizard.QUESTIONS]
    return {"agents": agents, "questions": questions, "recommended": wizard.recommended_answers()}


def compiler_oracle() -> dict:
    files = {rel: _sha256_file(rel) for rel in contract.ORACLE_FILES}
    return {"files": files, "sha256": hashlib.sha256(_compact(files)).hexdigest()}


def content_sha256(bundle: dict) -> str:
    """SHA-256 of the bundle's compact JSON, without its own `content_sha256`."""
    return hashlib.sha256(_compact({k: v for k, v in bundle.items() if k != "content_sha256"})).hexdigest()


def build_bundle() -> dict:
    from traceharness.__main__ import __version__
    bundle = {
        "schema": contract.SCHEMA,
        "package_version": __version__,
        "port": contract.PORT,
        "local_app": contract.local_app(),
        "limits": {"prompt_max_bytes": contract.PROMPT_MAX_BYTES,
                   "runner_prompt_max_bytes": contract.RUNNER_PROMPT_MAX_BYTES,
                   "run": {k: list(v) for k, v in contract.RUN_LIMITS.items()}},
        "display_classes": dict(contract.DISPLAY_CLASSES),
        "tokens": tokens(),
        "capture_sources": capture_sources(),
        "shallow": shallow(),
        "datasets": {"school": list(contract.SCHOOL_DATASETS)},
        "environment": {"capabilities": list(contract.CAPABILITIES), "table": contract.CAPABILITY_TABLE,
                        "messages": contract.MESSAGES, "library": contract.LIBRARY, "runner": list(contract.RUNNER)},
        "glossary": {"labels": contract.LABELS, "retired": [dict(r) for r in contract.RETIRED]},
        "drafts": {"prefix_member": contract.DRAFT_PREFIX_MEMBER, "prefix_local": contract.DRAFT_PREFIX_LOCAL,
                   "names": list(contract.DRAFT_NAMES)},
        "save_protocol": contract.SAVE_PROTOCOL,
        "compiler_oracle": compiler_oracle(),
    }
    # Round-trip through JSON so the hash is taken over exactly what is written (tuples -> lists).
    bundle = json.loads(json.dumps(bundle, ensure_ascii=False))
    bundle["content_sha256"] = content_sha256(bundle)
    return bundle


def render(bundle: dict) -> str:
    return json.dumps(bundle, sort_keys=True, indent=1, ensure_ascii=False) + "\n"


def stale(text: str, root: str = BASE) -> list[str]:
    """The TARGETS under `root` whose bytes differ from `text` (or that are missing)."""
    want = text.encode("utf-8")
    out = []
    for rel in TARGETS:
        try:
            with open(os.path.join(root, rel), "rb") as f:
                if f.read() == want:
                    continue
        except OSError:
            pass
        out.append(rel)
    return out


def main(argv: list[str] | None = None, root: str = BASE) -> int:
    import argparse
    p = argparse.ArgumentParser(prog="python -m traceharness.shared.generate",
                                description="Write the shared-sources bundle (both copies).")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--check", action="store_true", help="exit 1 when either copy is stale")
    g.add_argument("--stdout", action="store_true", help="print the bundle and write nothing")
    args = p.parse_args(argv)
    text = render(build_bundle())
    if args.stdout:
        sys.stdout.flush()
        sys.stdout.buffer.write(text.encode("utf-8"))
        sys.stdout.flush()
        return 0
    if args.check:
        bad = stale(text, root)
        for rel in bad:
            print(f"{rel} is stale: run python -m traceharness.shared.generate", file=sys.stderr)
        return 1 if bad else 0
    for rel in TARGETS:
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        print(f"wrote {rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
