"""Permission before live capture reads sessions on this machine.

`--watch` and `--backfill` read real coding-agent sessions into
data/runs/captured/. A person at a terminal has to type yes. `--yes` is that
same answer, already given. A non-interactive start (the test suite, or a
watcher already installed under launchd) has no terminal to ask, so it is
left as it was. The website cannot give this answer.
"""
from __future__ import annotations

PROMPT = (
    "Live capture reads coding-agent sessions on this machine into "
    "data/runs/captured/. Type yes to start: "
)


def confirm_live_capture(*, assume_yes: bool, isatty: bool, ask) -> bool:
    """True only when capture may read. `ask` is called only for a person at a terminal."""
    if assume_yes:
        return True
    if not isatty:
        return True
    try:
        answer = ask(PROMPT)
    except EOFError:
        return False
    return isinstance(answer, str) and answer.strip().lower() == "yes"
