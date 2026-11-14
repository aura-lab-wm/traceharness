# Issue #77: Deduper swallows an event that arrives exactly one window after the previous one

With `Deduper(10)`, `seen("job-1", 0)` returns `False` and then `seen("job-1", 10)`
returns `True`. The window is 10 seconds, and the second event is 10 seconds after
the first, so it should be reported as new. We also noticed the process memory
growing on a long-running consumer that sees millions of distinct keys.
Fix `events/dedup.py`.
