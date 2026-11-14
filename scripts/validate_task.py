#!/usr/bin/env python3
"""Validate one task folder of the extended suite. Standard library only.

    python3 validate_task.py <task_dir> [<task_dir> ...]

A task passes when ALL of these hold (each is run in a fresh temporary copy):
  1. layout: task.json, issue.md, repo/, repo/tests/, hidden_tests/, hidden_tests_strong/, reference/
  2. original repo:   visible tests may pass or fail; hidden tests FAIL
  3. reference/ overlaid on repo: visible, hidden and strong tests all PASS
  4. decoy/ (if present) overlaid on repo: visible tests PASS and hidden tests FAIL
  5. shallow/ (if present) overlaid on repo: hidden tests PASS and strong tests FAIL
  6. hygiene: test files are deterministic (two runs agree), run in < 20 s, need no network and
     no third-party package; the reference only changes files listed in task.json "src_files".
The tiers are built exactly as TraceHarness's grader builds them: the pristine repo/tests, plus
hidden_tests/*.py for the hidden tier, plus hidden_tests_strong/*.py for the strong tier.
"""
import json, os, shutil, subprocess, sys, tempfile, time

def run_tier(task_dir, overlay, subdirs):
    tmp = tempfile.mkdtemp(prefix="vt_")
    try:
        shutil.copytree(os.path.join(task_dir, "repo"), tmp, dirs_exist_ok=True)
        if overlay:
            shutil.copytree(os.path.join(task_dir, overlay), tmp, dirs_exist_ok=True)
        tests = os.path.join(tmp, "tests")
        shutil.rmtree(tests, ignore_errors=True)
        shutil.copytree(os.path.join(task_dir, "repo", "tests"), tests)
        for sd in subdirs:
            for f in os.listdir(os.path.join(task_dir, sd)):
                if f.endswith(".py"):
                    shutil.copy(os.path.join(task_dir, sd, f), tests)
        env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR")}
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        t0 = time.time()
        r = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-q"], cwd=tmp,
                           capture_output=True, text=True, timeout=60, env=env)
        return r.returncode == 0, (r.stdout + r.stderr)[-1500:], time.time() - t0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

TIERS = {"visible": (), "hidden": ("hidden_tests",), "strong": ("hidden_tests", "hidden_tests_strong")}

def validate(task_dir):
    errs, notes = [], []
    need = ["task.json", "issue.md", "repo", "repo/tests", "hidden_tests", "hidden_tests_strong", "reference"]
    for n in need:
        if not os.path.exists(os.path.join(task_dir, n)):
            errs.append(f"missing {n}")
    if errs:
        return errs, notes
    meta = json.load(open(os.path.join(task_dir, "task.json")))
    tid = os.path.basename(os.path.normpath(task_dir))
    for k in ("id", "title", "probe", "src_files", "test_cmd"):
        if k not in meta:
            errs.append(f"task.json lacks {k!r}")
    if meta.get("id") != tid:
        errs.append(f"task.json id {meta.get('id')!r} != folder name {tid!r}")
    if meta.get("test_cmd") != "python -m unittest discover -s tests -q":
        errs.append("test_cmd must be 'python -m unittest discover -s tests -q'")
    if meta.get("suite") != "extended":
        errs.append('task.json must carry "suite": "extended"')
    for src in meta.get("src_files", []):
        if not os.path.exists(os.path.join(task_dir, "repo", src)):
            errs.append(f"src_files entry {src} is not in repo/")
    ref_files = [os.path.relpath(os.path.join(dp, f), os.path.join(task_dir, "reference"))
                 for dp, _, fs in os.walk(os.path.join(task_dir, "reference")) for f in fs]
    extra = [f for f in ref_files if f not in meta.get("src_files", [])]
    if extra:
        errs.append(f"reference/ changes files outside src_files: {extra}")
    if any(f.startswith("tests") for f in ref_files):
        errs.append("reference/ must not touch tests/")
    res = {}
    for overlay in (None, "reference", "decoy", "shallow"):
        if overlay and not os.path.isdir(os.path.join(task_dir, overlay)):
            continue
        for tier, subdirs in TIERS.items():
            ok1, log, secs = run_tier(task_dir, overlay, subdirs)
            ok2, _, _ = run_tier(task_dir, overlay, subdirs)
            res[(overlay or "original", tier)] = ok1
            if ok1 != ok2:
                errs.append(f"{overlay or 'original'}/{tier}: two runs disagree (nondeterministic tests)")
            if secs > 20:
                errs.append(f"{overlay or 'original'}/{tier}: took {secs:.0f}s (> 20s)")
            if overlay == "reference" and not ok1:
                errs.append(f"reference fails the {tier} tier:\n{log}")
    if res.get(("original", "hidden")):
        errs.append("the original repo passes the hidden tests: there is no bug to fix")
    if ("decoy", "visible") in res:
        if not res[("decoy", "visible")]:
            errs.append("decoy fails the visible tests (it must pass them)")
        if res[("decoy", "hidden")]:
            errs.append("decoy passes the hidden tests (it must fail them)")
    if ("shallow", "hidden") in res:
        if not res[("shallow", "hidden")]:
            errs.append("shallow fails the hidden tests (it must pass them)")
        if res[("shallow", "strong")]:
            errs.append("shallow passes the strong tests (it must fail them)")
    notes.append("original: " + " ".join(f"{t}={'pass' if res[('original', t)] else 'FAIL'}" for t in TIERS))
    notes.append("has decoy" if ("decoy", "visible") in res else "no decoy")
    notes.append("has shallow" if ("shallow", "hidden") in res else "no shallow")
    return errs, notes

if __name__ == "__main__":
    bad = 0
    for d in sys.argv[1:]:
        errs, notes = validate(d)
        print(("FAIL " if errs else "OK   ") + d + "   [" + "; ".join(notes) + "]")
        for e in errs:
            print("   - " + e)
        bad += bool(errs)
    sys.exit(1 if bad else 0)
