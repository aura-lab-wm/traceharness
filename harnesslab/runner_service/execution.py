"""Digest-pinned, per-job Docker execution; importing this module runs nothing."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from contextlib import contextmanager
import sys

from .proxy import UnixModelProxy
from .registry import tree_hash


class ExecutionError(Exception):
    pass


class DockerExecutor:
    def __init__(self, settings, registry, command=subprocess.run):
        self.settings, self.registry, self.command = settings, registry, command
        self._reconciled, self._startup_blocked = False, False

    def reconcile_startup(self):
        if self._startup_blocked:
            return False
        if self._reconciled:
            return True
        result = self.command([self.settings.docker_binary, "ps", "--all", "--filter", "name=^/traceharness-", "--format", "{{.ID}}"],
                              capture_output=True, timeout=8, check=True)
        root = str(Path(self.settings.state_dir).resolve())
        mounts = Path("/proc/self/mountinfo").read_text().splitlines()
        mounted = any(line.split()[4].replace("\\040", " ").replace("\\011", "\t").replace("\\134", "\\").startswith(root + "/")
                      for line in mounts if len(line.split()) > 4)
        if result.stdout.strip() or mounted:
            self._startup_blocked = True
            return False
        self._reconciled = True
        return True

    def _inspect(self, *args):
        result = self.command([self.settings.docker_binary, *args], capture_output=True, timeout=8, check=True)
        return json.loads(result.stdout)

    def health(self):
        empty = {"available": False, "runtimes": {}, "tasks": {}}
        if not self.settings.execution_enabled:
            return empty
        try:
            if sys.platform != "linux" or os.geteuid() != 0:
                return empty
            capabilities = next(line.split()[1] for line in Path("/proc/self/status").read_text().splitlines() if line.startswith("CapEff:"))
            if not (int(capabilities, 16) & (1 << 21)):
                return empty  # Per-job tmpfs needs host control-plane CAP_SYS_ADMIN.
            if not self.reconcile_startup():
                return empty
            info = self._inspect("info", "--format", "{{json .}}")
            if self.settings.isolation_runtime not in info.get("Runtimes", {}):
                return empty
            runtimes = {}
            for rid, runtime in self.registry.runtimes.items():
                images = self._inspect("image", "inspect", runtime["image_digest"])
                image = images[0]
                labels = image.get("Config", {}).get("Labels", {}) or {}
                runtimes[rid] = bool(runtime["model_ids"] and runtime["image_digest"] in image.get("RepoDigests", [])
                                     and labels.get("org.traceharness.runtime") == rid
                                     and labels.get("org.traceharness.version") == runtime["version"])
            tasks = self.registry.task_health()
            for tid, task in self.registry.tasks.items():
                grader = self._inspect("image", "inspect", task["grader_image_digest"])[0]
                tasks[tid] = bool(tasks[tid] and task["grader_image_digest"] in grader.get("RepoDigests", [])
                                  and any(runtimes.get(rid) for rid in task["runtime_ids"]))
            return {"available": any(tasks.values()) and any(runtimes.values()), "runtimes": runtimes, "tasks": tasks}
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, IndexError, TypeError, StopIteration):
            return empty

    @contextmanager
    def bounded_storage(self, directory):
        mounted = []
        try:
            for name, size in (("workspace", "2g"), ("output", "64m"), ("grading", "16m")):
                path = directory / name
                path.mkdir(mode=0o755)
                self.command(["/bin/mount", "-t", "tmpfs", "-o", f"size={size},nosuid,nodev,mode=0755,uid=10001,gid=10001", "tmpfs", str(path)],
                             capture_output=True, timeout=10, check=True)
                mounted.append(path)
            yield
        finally:
            failed = False
            for path in reversed(mounted):
                try:
                    result = self.command(["/bin/umount", str(path)], capture_output=True, timeout=10, check=False)
                    failed = failed or result.returncode != 0
                except (OSError, subprocess.SubprocessError):
                    failed = True
            if failed:
                raise ExecutionError("Bounded storage cleanup needs operator attention.")

    def container_args(self, name, image, mounts, *, entrypoint):
        args = [self.settings.docker_binary, "run", "--name", name, "--pull", "never", "--rm", "--init",
                "--label", "org.traceharness.runner=private",
                "--runtime", self.settings.isolation_runtime, "--network", "none", "--read-only", "--user", "10001:10001",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--pids-limit", "256",
                "--memory", "4g", "--cpus", "2", "--ulimit", "fsize=67108864:67108864",
                "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m,mode=1777", "--env", "HOME=/tmp/home",
                "--env", "PYTHONDONTWRITEBYTECODE=1", "--workdir", "/workspace", "--entrypoint", entrypoint]
        for source, target, readonly in mounts:
            # Docker --mount rejects commas in host paths; refuse instead of reinterpreting.
            if "," in str(source):
                raise ExecutionError("Runner state path cannot contain commas.")
            args += ["--mount", f"type=bind,src={source},dst={target}" + (",readonly" if readonly else "")]
        return args + [image]

    def _run(self, args, name, cancel, deadline):
        # Container output is an untrusted artifact, not a service log.
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            while process.poll() is None:
                if cancel.is_set() or time.monotonic() >= deadline:
                    self.command([self.settings.docker_binary, "rm", "--force", name], capture_output=True, timeout=15, check=False)
                    process.wait(timeout=15)
                    raise ExecutionError("Execution was cancelled." if cancel.is_set() else "Execution reached its deadline.")
                time.sleep(0.1)
            if process.returncode:
                raise ExecutionError("Runtime process did not complete successfully.")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            # Best effort is not sufficient to claim cancelled; failure propagates.
            result = self.command([self.settings.docker_binary, "rm", "--force", name], capture_output=True, timeout=15, check=False)
            if result.returncode and b"No such container" not in result.stderr:
                raise ExecutionError("Container cleanup needs operator attention.")

    def execute(self, job_id, manifest, directory: Path, cancel, forward):
        with self.bounded_storage(directory):
            return self._execute_bounded(job_id, manifest, directory, cancel, forward)

    def _execute_bounded(self, job_id, manifest, directory: Path, cancel, forward):
        task = self.registry.tasks[manifest["task_id"]]
        source = Path(task["path"])
        if tree_hash(source) != manifest["task_content_sha256"]:
            raise ExecutionError("Task package changed after review.")
        work, inputs, output, gateway = [directory / name for name in ("workspace", "input", "output", "gateway")]
        for path in (inputs, gateway):
            path.mkdir(mode=0o755)
        # On a dedicated Linux host the control service owns mounts for uid10001.
        # No host home, Docker socket, or provider credential is exposed to the task.
        (inputs / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False))
        (inputs / "prompt.txt").write_text(manifest["prompt"])
        (inputs / "issue.md").write_bytes((source / "issue.md").read_bytes())
        name = "traceharness-" + job_id
        deadline = time.monotonic() + manifest["limits"]["wall_time_seconds"]
        with UnixModelProxy(gateway / "runner.sock", forward):
            args = self.container_args(name, manifest["image_digest"],
                [(work, "/workspace", False), (inputs, "/input", True), (output, "/output", False), (gateway, "/gateway", True), (source / "repo", "/taskrepo", True)],
                entrypoint="python") + ["-m", "harnesslab.runner_service.container_entrypoint"]
            self._run(args, name, cancel, deadline)
        if cancel.is_set():
            raise ExecutionError("Execution was cancelled.")
        # Grading is a separate offline process. The agent never sees hidden tests.
        grading = directory / "grading"
        args = self.container_args(name + "-grade", manifest["grader_image_digest"],
            [(work, "/workspace", True), (source, "/task", True), (grading, "/output", False)],
            entrypoint="/opt/traceharness-grade")
        self._run(args, name + "-grade", cancel, deadline)
        grade = grading / "grade.json"
        if grade.is_symlink() or not grade.is_file() or grade.stat().st_size > 65536:
            raise ExecutionError("The trusted grader did not return a bounded result.")
        result = json.loads(grade.read_text())
        if not isinstance(result, dict) or result.get("outcome") not in {"passed", "failed", "error"}:
            raise ExecutionError("The trusted grader returned an invalid result.")
        # Only the normalized grade is published. Runtime stdout and arbitrary files
        # remain private; untrusted artifacts are never blindly echoed to members.
        artifact = directory / "grade.json"
        raw = json.dumps({"outcome": result["outcome"]}, sort_keys=True).encode()
        artifact.write_bytes(raw)
        return {"artifacts": [{"name": "grade.json", "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}],
                "grade": result["outcome"],
                "issues": [] if result["outcome"] == "passed" else ["Execution finished; the trusted grader reported " + result["outcome"] + "."]}
