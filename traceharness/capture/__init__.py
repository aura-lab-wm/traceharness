"""The capture spine: turns allow-listed coding-agent session files into private traceharness ledgers.

Runbook: docs/capture.md -- the allow-list, Full Disk Access, --backfill then --seed-cursors, the
launchd agents and the menu-bar app. Sessions are regenerated whole, never parsed incrementally, and
written to data/runs/captured/, which every default listing and export excludes
(traceharness/backend/results_scope.py).
"""
