#!/usr/bin/env python3
"""SessionEnd hook: upload the finished Claude Code session with traceharness.

Contract: always exit 0 and print nothing, whatever happens (traceharness not
installed, not signed in, no network, bad stdin). It must never block or fail a session.
"""
import json
import os
import shutil
import subprocess
import sys

TIMEOUT_S = 45


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        path = payload.get("transcript_path") if isinstance(payload, dict) else None
        if not isinstance(path, str) or not path or not os.path.isfile(path):
            return
        exe = shutil.which("traceharness")
        if not exe:
            return
        subprocess.run(
            [exe, "capture", "push", "--source", "claude_code", "--session-file", path, "--quiet"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=TIMEOUT_S, check=False,
        )
    except BaseException:  # noqa: BLE001 - nothing may escape
        pass


if __name__ == "__main__":
    main()
    sys.exit(0)
