"""The retired-phrase check (SPEC 4.4).

    python -m traceharness.shared.vocabulary --check                 every file in scope
    python -m traceharness.shared.vocabulary --check --only README.md

prints `file:line: phrase` for each retired phrase it finds and exits 1 on any hit. A phrase matches
exactly and case-sensitively, as a whole word: `local lab` is a hit, `local label` is not.
"""
from __future__ import annotations

import os
import re
import sys

from .contract import RETIRED

#: The repository root of this checkout.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

#: The documents and backend files in scope, besides the console sources.
DOCUMENTS = (
    "traceharness/backend/static_export.py", "README.md", "HANDOUT.md", "LAB_1H.md", "SCHOOL_PACKAGE.md",
    "docs/STUDENT_GUIDE.md", "docs/GUIDE.md", "docs/CODESPACES.md", "docs/member-workbench.md",
    "docs/NATIVE_PROMPT_INTERVENTIONS.md", "deploy/runner/README.md", "deploy/runner/fly/README.md",
)


def _pattern(phrase: str) -> re.Pattern:
    return re.compile(r"(?<![A-Za-z0-9_])" + re.escape(phrase) + r"(?![A-Za-z0-9_])")


def find_retired(text: str, scope: str = "all") -> list[tuple[str, int]]:
    """(phrase, 1-based line) for every retired phrase in `text`. `scope="all"` checks the phrases
    retired everywhere; `scope="site"` adds the ones retired on the site only."""
    phrases = [r["phrase"] for r in RETIRED if r["scope"] in ("all", scope)]
    hits = []
    for number, line in enumerate(text.splitlines(), start=1):
        for phrase in phrases:
            if _pattern(phrase).search(line):
                hits.append((phrase, number))
    return hits


def scope_files(root: str = ROOT) -> list[str]:
    """Every file in scope, repository-relative: non-test console sources plus DOCUMENTS."""
    src = os.path.join(root, "traceharness", "frontend", "src")
    out = []
    for d, dirs, files in os.walk(src):
        dirs.sort()
        for f in sorted(files):
            if f.endswith((".js", ".jsx")) and ".test." not in f:
                out.append(os.path.relpath(os.path.join(d, f), root).replace(os.sep, "/"))
    out += [rel for rel in DOCUMENTS if os.path.isfile(os.path.join(root, rel))]
    return sorted(out)


def check(files: list[str], root: str = ROOT) -> list[tuple[str, int, str]]:
    out = []
    for rel in files:
        with open(os.path.join(root, rel), encoding="utf-8") as f:
            out += [(rel, line, phrase) for phrase, line in find_retired(f.read())]
    return out


def main(argv: list[str] | None = None) -> int:
    import argparse
    p = argparse.ArgumentParser(prog="python -m traceharness.shared.vocabulary",
                                description="Find retired phrases in the console sources and documents.")
    p.add_argument("--check", action="store_true", help="print each hit as file:line: phrase; exit 1 on any")
    p.add_argument("--only", nargs="+", metavar="PATH", help="check only these repository-relative files")
    args = p.parse_args(argv)
    if not args.check:
        p.print_help()
        return 2
    hits = check(args.only or scope_files())
    for rel, line, phrase in hits:
        print(f"{rel}:{line}: {phrase}")
    return 1 if hits else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
