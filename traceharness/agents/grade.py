"""Grades a third-party agent's workspace inside a container (traceharness/agents). Standard library only.

The container has no network and mounts read-only: the workspace the agent left (/candidate), the
task (/task) and TraceHarness itself (/opt/th, for traceharness.core.grader). The workspace is
copied into /tmp first, without the git directory the agent's container created and without
symbolic links, and graded there by the same three-tier grader as the lab's own runs (visible,
hidden, strong; pristine visible tests restored; nonce-checked report; static test count).
Prints one JSON object: {"visible", "hidden", "strong", "logs"}.
"""
from __future__ import annotations

import json
import os
import shutil
import stat
import sys

sys.path.insert(0, "/opt/th")
from traceharness.core.grader import grade  # noqa: E402


def copy_regular(src: str, dst: str) -> None:
    """Copy only directories and regular files; a symlink in the workspace is not followed."""
    for root, dirs, files in os.walk(src, followlinks=False):
        rel = os.path.relpath(root, src)
        dirs[:] = [d for d in dirs if d != ".git" and not os.path.islink(os.path.join(root, d))]
        os.makedirs(os.path.join(dst, rel), exist_ok=True)
        for name in files:
            p = os.path.join(root, name)
            if stat.S_ISREG(os.lstat(p).st_mode):
                shutil.copyfile(p, os.path.join(dst, rel, name))


def main() -> int:
    work = "/tmp/candidate"
    copy_regular("/candidate", work)
    g = grade("/task", work)
    g["logs"] = {k: v[-3000:] for k, v in (g.get("logs") or {}).items()}
    print(json.dumps(g))
    return 0


if __name__ == "__main__":
    sys.exit(main())
