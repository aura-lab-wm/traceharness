"""`traceharness agents build|list|run`: third-party agents in containers, on the lab's tasks.

One run uses three containers of the image built from traceharness/agents/Dockerfile:

  broker   the only container with network access and the only place the OpenRouter key exists
           (passed by name from this process's environment, never in an argument). It serves the
           model on a Unix socket in a per-run Docker volume and fixes model, hosts (provider.order,
           fallbacks off), output cap and number of calls (broker.py).
  agent    --network none. The agent works on a copy of the task repository and reaches its model
           only through that socket (inside.py). Its native log is written to the run's output.
  grader   --network none, read-only mounts. The workspace the agent left is graded by
           traceharness.core.grader (visible, hidden and strong tiers) without git or symlinks.

Every container: read-only root, non-root user, no capabilities, no-new-privileges, memory, CPU and
PID limits, a bounded /tmp. No host directory other than the run's own job folder, the task
(read-only) and, for the grader, the traceharness package (read-only) is mounted, and the Docker
socket never is. This process never executes anything from the workspace: it reads files only
with lstat checks and size caps.

After a run, each OpenRouter generation id the broker logged is resolved (GET /api/v1/generation)
to the host that served it and its cost, which become the run's `served_by` and `cost_usd`. The
agent's log is converted by the import adapter of that agent (mini_swe_agent, codex, claude_code)
into the ledger, with the real grades in its `grade` span.

    traceharness agents build
    traceharness agents run --agent codex --model openai/gpt-5.1-codex-mini --route Azure \
        --tasks full --repeats 3 --out data/runs/codex_full
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict

from traceharness.core.ledger import new_run_id
from traceharness.core.grader import load_task
from traceharness.core.runner import LAB_ROOT, resolve_task_ids

HERE = os.path.dirname(os.path.abspath(__file__))
PACKAGE = os.path.dirname(HERE)                      # .../traceharness (mounted read-only into the grader)
IMAGE = "traceharness-agents"
IMAGE_TAG = "0.5.0"
UID = "10001:10001"

#: The agents and what is pinned about each. `importer` is the adapter in backend/importers that
#: reads its native log; `native` the glob of that log in the run's output.
AGENTS = {
    "mini-swe-agent": {"version": "2.4.6", "importer": "mini_swe_agent", "native": "mini.traj.json",
                       "protocol": "chat/completions"},
    "codex": {"version": "0.167.1", "importer": "codex", "native": "*rollout-*.jsonl", "protocol": "responses"},
    "claude-code": {"version": "2.1.322", "importer": "claude_code", "native": "*.jsonl", "protocol": "messages"},
}

#: Flags every container of a run gets.
HARDENING = ["--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", UID,
             "--tmpfs", "/tmp:rw,size=1g,mode=1777"]

MAX_NATIVE = 64 * 1024 * 1024        # largest native log read back from a container
MAX_FILE = 2 * 1024 * 1024           # largest workspace file read to build the patch

_INDEX_LOCK = threading.Lock()


# ---------------------------------------------------------------- docker
def docker(args: list, timeout: float = 120, check: bool = True, **kw) -> subprocess.CompletedProcess:
    r = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout, **kw)
    if check and r.returncode != 0:
        raise RuntimeError(f"docker {args[0]} failed ({r.returncode}): {(r.stderr or r.stdout).strip()[-400:]}")
    return r


def image_ref() -> str:
    return f"{IMAGE}:{IMAGE_TAG}"


def image_id(ref: str = "") -> str:
    """The local image's id, or "" when it is not built (or Docker is not installed)."""
    try:
        r = docker(["image", "inspect", "--format", "{{.Id}}", ref or image_ref()], check=False, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return r.stdout.strip() if r.returncode == 0 else ""


REAL_TASKS = os.path.join(LAB_ROOT, "deploy", "runner", "tasks")     # recipes, grade.py, requirements.lock
GRADER_IMAGE = "traceharness-realrepo-grader"


def pydeps_ref() -> str:
    return f"{IMAGE}:{IMAGE_TAG}-pydeps"


def grader_ref() -> str:
    return f"{GRADER_IMAGE}:{IMAGE_TAG}"


def build_real_repos() -> int:
    """The agent image with the packages' dependencies, and the packages' own grader image
    (deploy/runner/grader.Dockerfile: root writer, candidate checks as an unprivileged child)."""
    import tempfile
    lock = os.path.join(REAL_TASKS, "requests-jsondecode-pickle", "requirements.lock")
    with tempfile.TemporaryDirectory(prefix="th-build-", dir=os.path.expanduser("~")) as ctx:
        shutil.copy(lock, os.path.join(ctx, "requirements.lock"))
        shutil.copy(os.path.join(HERE, "Dockerfile.pydeps"), os.path.join(ctx, "Dockerfile"))
        r = subprocess.run(["docker", "build", "-t", pydeps_ref(), "--build-arg", f"BASE={image_ref()}", ctx])
        if r.returncode:
            return r.returncode
        os.makedirs(os.path.join(ctx, "grader"))
        shutil.copy(os.path.join(REAL_TASKS, "grade.py"), os.path.join(ctx, "grader", "grade.py"))
        shutil.copy(os.path.join(LAB_ROOT, "deploy", "runner", "grader.Dockerfile"), os.path.join(ctx, "Dockerfile"))
        r = subprocess.run(["docker", "build", "-t", grader_ref(), ctx])
    if r.returncode == 0:
        print(f"built {pydeps_ref()} and {grader_ref()}")
    return r.returncode


def build(no_cache: bool = False) -> int:
    args = ["build", "-t", image_ref()]
    for name, spec in (("MINI_SWE_AGENT", AGENTS["mini-swe-agent"]), ("CODEX", AGENTS["codex"]),
                       ("CLAUDE_CODE", AGENTS["claude-code"])):
        args += ["--build-arg", f"{name}={spec['version']}"]
    if no_cache:
        args.append("--no-cache")
    r = subprocess.run(["docker", *args, HERE])
    if r.returncode == 0:
        print(f"built {image_ref()} {image_id()}")
    return r.returncode


# ---------------------------------------------------------------- host-side reading of untrusted output
def read_capped(path: str, cap: int) -> bytes:
    """A regular file's bytes, refusing symlinks, FIFOs and files over `cap`."""
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size > cap:
            raise ValueError(f"{os.path.basename(path)}: not a regular file of at most {cap} bytes")
        with os.fdopen(fd, "rb") as f:
            fd = -1
            return f.read(cap + 1)[:cap]
    finally:
        if fd >= 0:
            os.close(fd)


def regular_files(root: str) -> dict:
    """{relative path: bytes} of the regular files under `root`, not following symlinks, skipping .git."""
    out = {}
    for dp, dn, fn in os.walk(root, followlinks=False):
        dn[:] = sorted(d for d in dn if d != ".git" and d != "__pycache__" and not os.path.islink(os.path.join(dp, d)))
        for name in sorted(fn):
            p = os.path.join(dp, name)
            rel = os.path.relpath(p, root)
            try:
                if stat.S_ISREG(os.lstat(p).st_mode) and os.lstat(p).st_size <= MAX_FILE and not name.endswith(".pyc"):
                    out[rel] = read_capped(p, MAX_FILE)
            except (OSError, ValueError):
                continue
    return out


def workspace_patch(before: dict, after: dict) -> tuple[str, list, bool]:
    """(unified diff, files touched, whether a file under tests/ changed) between two file maps."""
    import difflib
    chunks, touched, tests = [], [], False
    for rel in sorted(set(before) | set(after)):
        a, b = before.get(rel), after.get(rel)
        if a == b:
            continue
        touched.append(rel)
        if rel.startswith("tests/") or rel.startswith("tests" + os.sep):
            tests = True
        try:
            at = a.decode("utf-8").splitlines() if a is not None else []
            bt = b.decode("utf-8").splitlines() if b is not None else []
        except UnicodeDecodeError:
            chunks.append(f"Binary files a/{rel} and b/{rel} differ")
            continue
        chunks.extend(difflib.unified_diff(at, bt, fromfile=f"a/{rel}" if a is not None else "/dev/null",
                                           tofile=f"b/{rel}" if b is not None else "/dev/null", lineterm=""))
    return "\n".join(chunks) + ("\n" if chunks else ""), touched, tests


# ---------------------------------------------------------------- OpenRouter generation stats
def resolve_generations(records: list, key: str, wait_s: float = 45) -> None:
    """Add `served_by`, `cost_usd`, `tokens_in`, `tokens_out`, `cached` to each logged call, in place,
    from OpenRouter's generation endpoint (the stats appear a few seconds after the call)."""
    deadline = time.time() + wait_s
    for rec in records:
        gid = rec.get("gen_id")
        if not gid or rec.get("status") != 200:
            continue
        delay = 1.0
        while True:
            req = urllib.request.Request("https://openrouter.ai/api/v1/generation?id=" + urllib.request.quote(gid),
                                         headers={"Authorization": "Bearer " + key})
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    d = json.loads(r.read()).get("data") or {}
                rec.update(served_by=d.get("provider_name") or "", cost_usd=d.get("total_cost"),
                           tokens_in=d.get("native_tokens_prompt"), tokens_out=d.get("native_tokens_completion"),
                           cached=d.get("native_tokens_cached"), served_model=d.get("model"))
                break
            except (urllib.error.URLError, ValueError, OSError):
                if time.time() + delay > deadline:
                    rec["unresolved"] = True
                    break
                time.sleep(delay)
                delay = min(delay * 2, 8)


# ---------------------------------------------------------------- one run
def task_text(task: dict) -> str:
    return (f"{task['issue'].strip()}\n\nThe repository is in the current directory. "
            f"Its tests run with `{task['test_cmd']}`.")


def harness_for(agent: str, model: str, route: list, max_requests: int, wall_s: int, img: str, ref: str = "") -> dict:
    spec = AGENTS[agent]
    h = {"id": f"{agent}-{spec['version']}", "agent": agent, "agent_version": spec["version"],
         "runtime": "container", "image": ref or image_ref(), "model": model,
         "route": list(route), "fallbacks": False, "max_model_requests": max_requests, "wall_s": wall_s,
         "container": {"network": "none (model through the broker's Unix socket)", "capabilities": "none",
                       "no_new_privileges": True, "read_only_root": True, "user": UID,
                       "workspace": "in-memory volume, read back as regular files only"},
         "system_prompt": "the agent's own", "tools": "the agent's own"}
    h["hash"] = hashlib.sha256(json.dumps(h, sort_keys=True).encode()).hexdigest()[:12]
    # provenance that does not define the harness: which image build and which copy of the scripts ran
    h["image_id"] = img
    h["scripts_sha256"] = {}
    for n in ("broker.py", "inside.py", "grade.py"):
        with open(os.path.join(HERE, n), "rb") as f:
            h["scripts_sha256"][n] = hashlib.sha256(f.read()).hexdigest()[:16]
    return h


def load_package(pkg: str) -> dict:
    """A real-repository task package (scripts/package_runner_task.py) as a task dict."""
    with open(os.path.join(pkg, "task.json")) as f:
        meta = json.load(f)
    with open(os.path.join(pkg, "issue.md")) as f:
        issue = f.read()
    return {"id": os.path.basename(os.path.normpath(pkg)), "dir": pkg, "issue": issue,
            "test_cmd": meta["visible_test_command"], "package": True}


def grade_package(ws_volume: str, pkg: str, runtime: list) -> dict:
    """The package's own grader (its edit contract and independent checks), in its own container:
    no network, read-only task and workspace, root only to write the result, the candidate's checks
    as an unprivileged child (deploy/runner/tasks/grade.py)."""
    r = docker(["run", "--rm", *runtime, "--network", "none", "--read-only", "--cap-drop", "ALL", "--cap-add", "SETUID",
                "--cap-add", "SETGID", "--cap-add", "KILL", "--security-opt", "no-new-privileges",
                "--memory", "1g", "--cpus", "1", "--pids-limit", "256", "--tmpfs", "/tmp:rw,size=1g,mode=1777",
                "--tmpfs", "/output:rw,size=1m,mode=0755", "-v", f"{ws_volume}:/workspace:ro", "-v", f"{pkg}:/task:ro",
                "--entrypoint", "sh", grader_ref(), "-c",
                "python -I /opt/traceharness-grader/grade.py >/dev/null 2>&1; cat /output/grade.json"],
               timeout=300, check=False)
    try:
        res = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        res = {"outcome": "error", "reason": (r.stderr or "no grade.json")[-300:]}
    return {"visible": None, "hidden": res.get("outcome") == "passed", "strong": None,
            "logs": {"package_grader": json.dumps(res)}, "package_outcome": res.get("outcome")}


def grade_lab(ws_volume: str, task: dict, runtime: list) -> dict:
    """traceharness.core.grader on the agent's workspace, in a container without network that mounts
    the workspace, the task and traceharness/core read-only (grade.py)."""
    g = docker(["run", "--rm", *runtime, *HARDENING, "--network", "none", "--memory", "1g", "--cpus", "1",
                "--pids-limit", "256", "-v", f"{ws_volume}:/candidate:ro", "-v", f"{task['dir']}:/task:ro",
                "-v", f"{os.path.join(PACKAGE, 'core')}:/opt/th/traceharness/core:ro",
                "-v", f"{HERE}:/opt/agents:ro", image_ref(), "python3", "-I", "-B", "/opt/agents/grade.py"],
               timeout=600, check=False)
    try:
        return json.loads(g.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {"visible": None, "hidden": None, "strong": None, "logs": {"error": (g.stderr or "")[-500:]},
                "grading_failed": True}


#: Runs in a container that mounts the run's workspace and output volumes read-only: a tar stream of
#: their regular files (no links, devices or git internals), within a total size cap, on stdout.
EXPORT = r"""
import os, stat, sys, tarfile
cap, per_file, total, skipped = int(sys.argv[1]), int(sys.argv[2]), 0, 0
tf = tarfile.open(fileobj=sys.stdout.buffer, mode="w|")
for top, arc in (("/w", "workspace"), ("/o", "output")):
    for dp, dn, fn in os.walk(top, followlinks=False):
        dn[:] = sorted(d for d in dn if d not in (".git", "__pycache__") and not os.path.islink(os.path.join(dp, d)))
        for n in sorted(fn):
            p = os.path.join(dp, n)
            st = os.lstat(p)
            if not stat.S_ISREG(st.st_mode) or n.endswith(".pyc"):
                continue
            if st.st_size > per_file or total + st.st_size > cap:
                skipped += 1
                continue
            ti = tarfile.TarInfo(arc + "/" + os.path.relpath(p, top))
            ti.size, ti.mode = st.st_size, 0o644
            with open(p, "rb") as f:
                tf.addfile(ti, f)
            total += st.st_size
tf.close()
print(skipped, file=sys.stderr)
"""
EXPORT_CAP = 192 * 1024 * 1024


def export_volumes(ws_volume: str, out_volume: str, dest: str, runtime: list) -> int:
    """Copy the regular files of the workspace and output volumes into `dest`/{workspace,output}.
    Returns how many files were left out by the size caps."""
    r = subprocess.run(["docker", "run", "--rm", *runtime, *HARDENING, "--network", "none", "--memory", "512m",
                        "--pids-limit", "64", "-v", f"{ws_volume}:/w:ro", "-v", f"{out_volume}:/o:ro", image_ref(),
                        "python3", "-I", "-c", EXPORT, str(EXPORT_CAP), str(MAX_NATIVE)],
                       capture_output=True, timeout=300)
    if r.returncode != 0:
        raise RuntimeError("export failed: " + r.stderr.decode(errors="replace")[-300:])
    extract_export(r.stdout, dest)
    try:
        return int(r.stderr.decode().strip().splitlines()[-1])
    except (ValueError, IndexError):
        return 0


def extract_export(data: bytes, dest: str) -> list:
    """Unpack an export stream into `dest`: regular files under workspace/ or output/ only, through
    tarfile's "data" filter (no absolute paths, no `..`, no links, devices or set-id bits)."""
    import io
    import tarfile
    if len(data) > EXPORT_CAP + 64 * 1024 * 1024:
        raise ValueError("export stream larger than its cap")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as tf:
        members = [m for m in tf.getmembers() if m.isfile() and m.name.split("/", 1)[0] in ("workspace", "output")
                   and ".." not in m.name.split("/") and not m.name.startswith("/")]
        tf.extractall(dest, members=members, filter="data")
    return [m.name for m in members]


def tmpfs_volume(name: str, size: str) -> None:
    docker(["volume", "create", "--driver", "local", "--opt", "type=tmpfs", "--opt", "device=tmpfs",
            "--opt", f"o=size={size},uid=10001,gid=10001,mode=0755", name])


def run_one(agent: str, model: str, route: list, task_id: str, repeat: int, out_root: str, opts) -> dict:
    """One run. Nothing the agent can write is a host folder: its workspace and output are size-capped
    in-memory volumes, read back by a separate export container as regular files only."""
    package = getattr(opts, "task_packages", None)
    task = load_package(os.path.join(package, task_id)) if package else load_task(os.path.join(LAB_ROOT, "tasks", task_id))
    runtime = ["--runtime", opts.runtime] if getattr(opts, "runtime", None) else []
    run_id = new_run_id()
    jobs_root = os.path.join(out_root, ".jobs")
    os.makedirs(jobs_root, mode=0o700, exist_ok=True)
    job = os.path.join(jobs_root, run_id)
    inp, logd, exp = (os.path.join(job, d) for d in ("input", "log", "export"))
    for d in (inp, logd, exp):
        os.makedirs(d)
    with open(os.path.join(inp, "job.json"), "w") as f:
        json.dump({"agent": agent, "model": model, "task_text": task_text(task), "wall_s": opts.wall,
                   "max_steps": opts.max_requests}, f)
    os.chmod(job, 0o755)
    os.chmod(inp, 0o755)
    os.chmod(os.path.join(inp, "job.json"), 0o644)
    os.chmod(logd, 0o777)                    # written by the broker's unprivileged user
    before = regular_files(os.path.join(task["dir"], "repo"))

    vol_sock, vol_ws, vol_out = f"th-sock-{run_id}", f"th-ws-{run_id}", f"th-out-{run_id}"
    broker, box = f"th-broker-{run_id}", f"th-agent-{run_id}"
    ref = pydeps_ref() if task.get("package") else image_ref()
    img = image_id(ref)
    t0 = time.time()
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    exit_info, error, left_out = {}, "", 0
    scripts = ["-v", f"{HERE}:/opt/agents:ro"]
    hold = f"th-hold-{run_id}"
    docker(["volume", "create", vol_sock])
    tmpfs_volume(vol_ws, opts.workspace_size)
    tmpfs_volume(vol_out, "256m")
    try:
        # An in-memory volume lives only while a container mounts it: this one keeps the run's
        # workspace and output mounted from the copy of the task until grading is done.
        docker(["run", "-d", "--name", hold, *HARDENING, "--network", "none", "--memory", "32m", "--pids-limit", "8",
                "-v", f"{vol_ws}:/w", "-v", f"{vol_out}:/o", image_ref(), "sleep", str(opts.wall + 1800)])
        docker(["run", "--rm", *runtime, *HARDENING, "--network", "none", "--memory", "256m", "--pids-limit", "64",
                "-v", f"{vol_ws}:/workspace", "-v", f"{os.path.join(task['dir'], 'repo')}:/taskrepo:ro", ref,
                "sh", "-c", "cp -R /taskrepo/. /workspace/"])
        cfg = {"model": model, "route": list(route), "max_requests": opts.max_requests,
               "max_input_bytes": opts.max_input_bytes, "max_output_tokens": opts.max_output_tokens, "timeout_s": 180}
        docker(["run", "-d", "--name", broker, *HARDENING, "--memory", "256m", "--cpus", "0.5", "--pids-limit", "64",
                "-e", "OPENROUTER_API_KEY", "-e", "BROKER_CONFIG=" + json.dumps(cfg), *scripts,
                "-v", f"{vol_sock}:/sock", "-v", f"{logd}:/log", image_ref(), "python3", "-I", "/opt/agents/broker.py"])
        for _ in range(100):
            if os.path.exists(os.path.join(logd, "ready")):
                break
            time.sleep(0.2)
        else:
            raise RuntimeError("the broker did not start: " + docker(["logs", broker], check=False).stderr[-300:])
        try:
            docker(["run", "--name", box, *runtime, *HARDENING, "--network", "none", "--memory", opts.memory,
                    "--cpus", str(opts.cpus), "--pids-limit", "512", *scripts, "-v", f"{vol_sock}:/sock:ro",
                    "-v", f"{vol_ws}:/workspace", "-v", f"{vol_out}:/output", "-v", f"{inp}:/input:ro",
                    ref, "python3", "-I", "/opt/agents/inside.py"], timeout=opts.wall + 120, check=False)
        except subprocess.TimeoutExpired:
            docker(["kill", box], check=False)
            error = "container wall-clock limit"
        docker(["rm", "-f", box, broker], check=False)
        left_out = export_volumes(vol_ws, vol_out, exp, runtime)
        grades = grade_package(vol_ws, task["dir"], runtime) if task.get("package") else grade_lab(vol_ws, task, runtime)
    finally:
        docker(["rm", "-f", box, broker, hold], check=False)
        docker(["volume", "rm", "-f", vol_sock, vol_ws, vol_out], check=False)
    outd = os.path.join(exp, "output")
    try:
        exit_info = json.loads(read_capped(os.path.join(outd, "exit.json"), 4096))
    except (OSError, ValueError):
        exit_info = {}
    after = regular_files(os.path.join(exp, "workspace"))
    patch, touched, tests_changed = workspace_patch(before, after)
    if task.get("package"):
        tests_changed = any(p.startswith("public_tests/") for p in touched)
    if left_out:
        exit_info["files_left_out_by_size_caps"] = left_out

    # the broker's log, resolved to hosts and costs
    calls = []
    try:
        calls = [json.loads(l) for l in read_capped(os.path.join(logd, "relay.jsonl"), MAX_NATIVE).decode().splitlines() if l.strip()]
    except (OSError, ValueError):
        pass
    resolve_generations(calls, os.environ.get("OPENROUTER_API_KEY", ""))

    summary = write_run(agent, model, route, task["id"], repeat, run_id, out_root, outd, grades, patch, touched,
                        tests_changed, calls, exit_info, error, started, int((time.time() - t0) * 1000), img, opts, ref)
    if not opts.keep_workdir:
        shutil.rmtree(job, ignore_errors=True)
    return summary


def mini_exit_reason(native_exit: str) -> str:
    """mini-SWE-agent's exit status as a lab exit reason. RepeatedFormatError means the model kept
    replying without a tool call until the agent gave up: the lab runner calls that `no_action`."""
    return {"submitted": "submitted", "limitsexceeded": "max_steps", "timeexceeded": "max_steps",
            "repeatedformaterror": "no_action"}.get((native_exit or "").lower(), "error")


def write_run(agent, model, route, task_id, repeat, run_id, out_root, outd, grades, patch, touched, tests_changed,
              calls, exit_info, error, started, wall_ms, img, opts, ref="") -> dict:
    from traceharness.backend.importers import _ADAPTER
    from traceharness.backend.importers.common import Session, convert
    import fnmatch
    spec = AGENTS[agent]
    harness = harness_for(agent, model, route, opts.max_requests, opts.wall, img, ref or image_ref())
    if grades.get("grading_failed"):
        error = error or "grading failed"
    native_dir = os.path.join(outd, "native")
    native = sorted(f for f in (os.listdir(native_dir) if os.path.isdir(native_dir) else []) if fnmatch.fnmatch(f, spec["native"]))
    sess = None
    importer = _ADAPTER[spec["importer"]]
    for name in native:
        path = os.path.join(native_dir, name)
        try:
            read_capped(path, MAX_NATIVE)              # refuses links and oversized files before the adapter opens it
            found = list(importer.sessions(path))
        except (OSError, ValueError):
            continue
        # Claude Code may write a subagent file next to the main one: keep the longest session
        for s in found:
            if sess is None or len(s.events) > len(sess.events):
                sess = s
    if sess is None:                                   # no log (crash before the first call): an empty session
        sess = Session(source=spec["importer"], session_id=run_id, path="", model=model, agent=agent,
                       agent_version=spec["version"], events=[], exit_status="no native log")
    sess.patch = patch
    g = {"visible": grades.get("visible"), "hidden": grades.get("hidden"), "strong": grades.get("strong"),
         "tests_modified": tests_changed,
         "source": ("the package's own grader (edit contract + independent checks) in a container without network"
                    if grades.get("package_outcome") is not None else
                    "traceharness.core.grader in a container without network")}
    s = convert(sess, out_root, task_id, harness, model_override=model, run_id=run_id, grades=g)

    ok_calls = [c for c in calls if c.get("status") == 200]
    costs = [c.get("cost_usd") for c in ok_calls]
    served = []
    for c in ok_calls:
        if c.get("served_by") and c["served_by"] not in served:
            served.append(c["served_by"])
    s.provider = "openrouter"
    s.repeat_index = repeat
    s.started_at = started
    s.finished_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    s.wall_ms = wall_ms
    s.served_by = served
    s.steps = len(ok_calls)
    s.files_touched = touched
    s.patch_bytes = len(patch.encode())
    if all(isinstance(c, (int, float)) for c in costs):
        s.cost_usd = round(sum(costs), 8)
    else:
        s.cost_usd = None                             # a call whose cost could not be resolved: unknown, not zero
    tin = [c.get("tokens_in") for c in ok_calls]
    tout = [c.get("tokens_out") for c in ok_calls]
    if ok_calls and all(isinstance(x, int) for x in tin + tout):
        s.input_tokens, s.output_tokens = sum(tin), sum(tout)
    refused = any(c.get("refused") == "max_requests" for c in calls)
    if exit_info.get("timed_out") or error == "container wall-clock limit":
        s.exit_reason = "max_steps"
        s.error = f"wall-clock limit of {opts.wall} s"
    elif refused:
        s.exit_reason = "max_steps"
        s.error = f"model request cap of {opts.max_requests} reached"
    elif error:
        s.exit_reason, s.error = "error", error
    elif agent == "mini-swe-agent":
        # mini-SWE-agent states why it stopped; "Submitted" is its submit command
        native_exit = (sess.exit_status or "").lower()
        s.exit_reason = mini_exit_reason(native_exit)
        if s.exit_reason != "submitted":
            s.error = f"mini-SWE-agent stopped with {sess.exit_status or 'no exit status'}"
    elif exit_info.get("returncode") == 0:
        # Codex and Claude Code end by answering without a tool call; a clean exit is their submit
        s.exit_reason = "submitted"
    else:
        s.exit_reason = "error"
        s.error = f"{agent} exited with code {exit_info.get('returncode')}"
    failed = sorted({str(c.get("status")) for c in calls if c.get("status") not in (200, None) and not c.get("refused")})
    if failed:
        s.error = (s.error + "; " if s.error else "") + "model calls failed with HTTP " + ", ".join(failed)
    run_dir = os.path.join(out_root, run_id)
    with open(os.path.join(run_dir, "summary.json"), "w") as f:
        f.write(s.to_json())
    with open(os.path.join(run_dir, "relay.jsonl"), "w") as f:
        for c in calls:
            f.write(json.dumps(c) + "\n")
    with open(os.path.join(run_dir, "container.json"), "w") as f:
        json.dump({"harness": harness, "exit": exit_info, "native_logs": native,
                   "grade_logs": grades.get("logs") or {}}, f, indent=1)
    # the ledger's end span carries the resolved totals too
    lp = os.path.join(run_dir, "ledger.jsonl")
    with open(lp) as f:
        spans = [json.loads(l) for l in f if l.strip()]
    for sp in spans:
        if sp.get("span") == "invoke_agent" and sp.get("status") == "end":
            sp.update(cost_usd=s.cost_usd, served_by=served, model_requests=len(ok_calls), exit_reason=s.exit_reason)
        if sp.get("span") == "invoke_agent" and sp.get("status") == "start":
            sp.update(repeat_index=repeat)
    with open(lp, "w") as f:
        for sp in spans:
            f.write(json.dumps(sp, ensure_ascii=False, default=str) + "\n")
    row = asdict(s)
    with _INDEX_LOCK:
        with open(os.path.join(out_root, "index.jsonl"), "a") as f:
            f.write(json.dumps(row, default=str) + "\n")
    return row


# ---------------------------------------------------------------- CLI
def run_cli(argv) -> int:
    ap = argparse.ArgumentParser(prog="traceharness agents run", description="Run a third-party agent in containers on the lab's tasks.")
    ap.add_argument("--agent", required=True, choices=sorted(AGENTS))
    ap.add_argument("--model", required=True, help="OpenRouter model id, e.g. openai/gpt-5.1-codex-mini")
    ap.add_argument("--route", default="", help="comma-separated OpenRouter hosts to pin, in order, with fallbacks off")
    ap.add_argument("--tasks", default="all", help="as for `traceharness run`: all/core, extended, full, or ids "
                    "(with --task-packages: 'all' or package names)")
    ap.add_argument("--task-packages", default=None, help="a folder of real-repository task packages "
                    "(scripts/package_runner_task.py) to run instead of the lab's tasks; graded by their own grader")
    ap.add_argument("--repeats", type=int, default=1)
    ap.add_argument("--repeat-offset", type=int, default=0, help="index of the first repeat (to add repeats to a results directory)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--jobs", type=int, default=3, help="runs in parallel")
    ap.add_argument("--max-requests", type=int, default=50, help="model calls per run (the broker refuses more)")
    ap.add_argument("--max-output-tokens", type=int, default=8192)
    ap.add_argument("--wall", type=int, default=600, help="wall-clock seconds per run")
    ap.add_argument("--memory", default="2g")
    ap.add_argument("--cpus", type=float, default=1.0)
    ap.add_argument("--max-cost", type=float, default=None, help="stop starting runs once this many USD are spent")
    ap.add_argument("--max-input-bytes", type=int, default=24 * 1024 * 1024,
                    help="bytes a run may send to the model in total (bounds the input tokens it can be billed for)")
    ap.add_argument("--workspace-size", default="1g", help="size cap of the agent's in-memory workspace")
    ap.add_argument("--runtime", default=None, help="Docker runtime for the agent and grading containers, e.g. runsc (gVisor)")
    ap.add_argument("--keep-workdir", action="store_true")
    a = ap.parse_args(argv)
    if not os.environ.get("OPENROUTER_API_KEY"):
        print("OPENROUTER_API_KEY is not set", file=sys.stderr)
        return 2
    if not image_id():
        print(f"image {image_ref()} not found: run `traceharness agents build` first", file=sys.stderr)
        return 2
    route = [r.strip() for r in a.route.split(",") if r.strip()]
    os.makedirs(a.out, exist_ok=True)
    if a.task_packages:
        a.task_packages = os.path.abspath(a.task_packages)
        names = sorted(d for d in os.listdir(a.task_packages) if os.path.isfile(os.path.join(a.task_packages, d, "grading.json")))
        tasks = names if a.tasks in ("all", "full") else [t.strip() for t in a.tasks.split(",") if t.strip()]
        if not image_id(pydeps_ref()) or not image_id(grader_ref()):
            print("real-repository images missing: run `traceharness agents build --real-repos`", file=sys.stderr)
            return 2
    else:
        tasks = resolve_task_ids(a.tasks)
    cells = [(t, r) for r in range(a.repeat_offset, a.repeat_offset + a.repeats) for t in tasks]
    spent, done, lock = 0.0, 0, threading.Lock()
    stop = threading.Event()

    def one(cell):
        nonlocal spent, done
        if stop.is_set():
            return None
        t, r = cell
        try:
            row = run_one(a.agent, a.model, route, t, r, a.out, a)
        except Exception as e:
            print(f"  {t} r{r}: {type(e).__name__}: {e}", flush=True)
            return None
        with lock:
            done += 1
            spent += row.get("cost_usd") or 0.0
            if a.max_cost is not None and spent >= a.max_cost:
                stop.set()
            print(f"[{done:3d}/{len(cells)}] {a.agent} {t:22s} r{r} {'PASS' if row.get('hidden_pass') else 'fail'} "
                  f"calls={row.get('steps')} ${(row.get('cost_usd') or 0):.4f} exit={row.get('exit_reason')} "
                  f"hosts={','.join(row.get('served_by') or [])}", flush=True)
        return row

    with ThreadPoolExecutor(max_workers=max(1, a.jobs)) as ex:
        rows = [x for x in ex.map(one, cells) if x]
    print(f"{len(rows)} of {len(cells)} runs written to {os.path.join(a.out, 'index.jsonl')}; ${spent:.4f}"
          + (" (stopped at the spend cap)" if stop.is_set() else ""))
    return 0 if len(rows) == len(cells) else 1


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd == "build":
        rc = build(no_cache="--no-cache" in rest)
        return build_real_repos() if rc == 0 and "--real-repos" in rest else rc
    if cmd == "list":
        img = image_id()
        for name, spec in AGENTS.items():
            print(f"{name:15s} {spec['version']:9s} log read by importers/{spec['importer']}.py")
        print(f"image {image_ref()} {img or '(not built: traceharness agents build)'}")
        return 0
    if cmd == "run":
        return run_cli(rest)
    print(f"unknown agents command {cmd!r}: build, list or run", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
