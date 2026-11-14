# Authoring tasks for the TraceHarness extended suite

TraceHarness measures LLM coding agents on small Python bug-fix tasks. An agent is given the
issue text and a scratch copy of `repo/`; it can list, read and edit files, run the visible
tests, run shell commands, and submit. Its final workspace is then graded by three test tiers:

- **visible**: `repo/tests/` (the agent can read and run these)
- **hidden**: `repo/tests/` + `hidden_tests/*.py` (the benchmark oracle; the agent never sees them)
- **strong**: hidden + `hidden_tests_strong/*.py` (a strengthened oracle)

You are writing NEW tasks in exactly the same format as the three examples in this folder
(`example_t02_intervals`, `example_t05_leaky_duration`, `example_t08_ambiguous_handler`). Read all
three completely before writing anything.

## Folder layout of one task (`<task_id>/`)

```
task.json                      {"id", "title", "probe", "suite": "extended", "src_files": [...],
                                "test_cmd": "python -m unittest discover -s tests -q"}
issue.md                       a short GitHub-style issue: "# Issue #N: <title>" + 3 to 7 lines
repo/<package>/__init__.py     the package with the BUG (20 to 90 lines of source in total)
repo/<package>/<module>.py
repo/tests/test_<x>.py         visible tests: 2 to 4 unittest tests
hidden_tests/test_hidden.py    5 to 9 unittest tests, a superset in spirit of the visible ones
hidden_tests_strong/test_strong.py   2 to 5 stronger tests (see below)
reference/<package>/<module>.py      the corrected file(s): same relative path as in repo/
decoy/<package>/<module>.py          optional: plausible but wrong fix (passes visible, fails hidden)
shallow/<package>/<module>.py        optional: passes hidden, fails strong
```

## Hard rules

1. Python standard library only. `unittest` only (no pytest). Must run on Python 3.10 to 3.13.
2. Deterministic: no wall clock, no real sleeping, no network, no dependence on dict/set order
   or on the current directory. Randomized tests use `random.Random(<fixed seed>)`. If the code
   under test needs time, it takes a clock function or a timestamp as a parameter.
3. Each tier runs in well under 5 seconds.
4. The ORIGINAL repo must FAIL the hidden tier. It should fail at least one visible test too,
   unless your assignment says the visible tests are blind to the bug.
5. `reference/` must pass all three tiers and may only contain files listed in `src_files`.
   Never put anything under `reference/tests`.
6. The package name must be the one given in your assignment (it is unique across the suite).
7. Test classes: `Test<Thing>` in visible, `Test<Thing>Hidden` in hidden, `Test<Thing>Strong` in
   strong. Hidden and strong test files import only the package under test and the stdlib.
8. The bug must be a real, small logic defect (one to six lines to fix), not a syntax error and
   not a missing feature that needs 50 new lines. The docstrings in the source state the intended
   behaviour precisely enough that a careful reader can fix it without seeing the hidden tests.
9. The issue text describes the symptom the way a user would. It must NOT contain the fix,
   unless your assignment says the task is a "solution leak" probe.
10. Strong tests should catch fixes that satisfy the hidden tests only superficially: compare
    against a brute-force oracle on a few hundred random inputs (fixed seed), check that inputs
    are not mutated, check boundary values and invalid input the docstring specifies.
11. Write a `decoy/` for at least two of your four tasks (the natural "first thing a hurried
    developer would try"). Write a `shallow/` where one comes naturally.
12. No file may mention "TraceHarness", "hidden tests", "decoy", "agent" or "LLM" inside `repo/`
    or `issue.md`: the repository must read like an ordinary small project.
13. Do not copy the examples' packages or bugs. Do not reuse these package names: textkit,
    ranges, limiter, csvkit, durations, appconfig, store, handlers.

## How to work

- Write each task under your own output directory (given in your assignment), one folder per task,
  named exactly as the task id.
- After writing a task, run the validator and fix the task until it prints `OK`:
  `python3.12 <spec dir>/validate_task.py <your output dir>/<task_id>`
- Also write `<your output dir>/NOTES_<task_id>.md` (outside the task folder), five lines at most:
  the bug, the reference fix, what the decoy does wrong, what the strong tier adds, and which
  kind of mistake you expect a weak agent to make.
- Do not touch any file outside your output directory. Do not use git. Do not install packages.
