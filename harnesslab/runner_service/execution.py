"""Digest-pinned, per-job Docker execution; importing this module runs nothing."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time
from contextlib import contextmanager
import sys

from .proxy import UnixModelProxy
from .registry import tree_hash


class ExecutionError(Exception):
    def __init__(self, message, *, artifacts=None):
        super().__init__(message)
        self.artifacts = artifacts or []


ARTIFACT_LIMIT = 1024 * 1024
RUNTIME_ARTIFACTS = ("trace.jsonl", "messages.json", "patch.diff", "summary.json")


def _redacted(raw: bytes) -> bytes:
    """Artifacts are untrusted text; never publish credential-shaped values."""
    import base64

    def jwt_candidate(match):
        # Shape detection only, never authenticity verification. A Python path
        # such as requests.exceptions.JSONDecodeError is not a credential.
        candidate = match.group(0)
        try:
            parts = candidate.split(".")
            decoded = [base64.b64decode(part + "=" * (-len(part) % 4), altchars=b"-_", validate=True)
                       for part in parts]
            if any(base64.urlsafe_b64encode(value).rstrip(b"=").decode() != part
                   for part, value in zip(parts, decoded)):
                return candidate
            def invalid_constant(_):
                raise ValueError("Non-JSON constant")
            header, payload = [json.loads(value.decode("utf-8"), parse_constant=invalid_constant) for value in decoded[:2]]
            if (isinstance(header, dict) and isinstance(payload, dict)
                    and isinstance(header.get("alg"), str) and 1 <= len(header["alg"]) <= 128
                    and 16 <= len(decoded[2]) <= 1024):
                return "[redacted]"
        except (ValueError, UnicodeError, RecursionError):
            pass
        return candidate

    text = raw.decode("utf-8", errors="strict")
    text = re.sub(r"\bsk-(?:or-)?[A-Za-z0-9_-]{10,}\b", "[redacted]", text)
    text = re.sub(r"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{3,8192}\.[A-Za-z0-9_-]{22,1366}(?![A-Za-z0-9_-])",
                  jwt_candidate, text)
    text = re.sub(r"(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}", r"\1[redacted]", text)
    return text.encode("utf-8")


def _read_artifact(path: Path) -> bytes:
    # Open nonblocking as well as no-follow: a malicious FIFO must not hang the
    # privileged control plane between a stat and open.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > ARTIFACT_LIMIT:
            raise ValueError("Unsupported artifact")
        raw = stream.read(ARTIFACT_LIMIT + 1)
        if len(raw) > ARTIFACT_LIMIT:
            raise ValueError("Oversized artifact")
    return _redacted(raw)


def pinned_image_matches(reference, inspected):
    """Accept an actual immutable image ID or an exact registry manifest digest."""
    if re.fullmatch(r"sha256:[a-f0-9]{64}", reference):
        return inspected.get("Id") == reference
    return reference in inspected.get("RepoDigests", [])


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
                runtimes[rid] = bool(runtime["model_ids"] and pinned_image_matches(runtime["image_digest"], image)
                                     and labels.get("org.traceharness.runtime") == rid
                                     and labels.get("org.traceharness.version") == runtime["version"])
            tasks = self.registry.task_health()
            for tid, task in self.registry.tasks.items():
                grader = self._inspect("image", "inspect", task["grader_image_digest"])[0]
                tasks[tid] = bool(tasks[tid] and pinned_image_matches(task["grader_image_digest"], grader)
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
                ownership = "mode=0700,uid=0,gid=0" if name == "grading" else "mode=0755,uid=10001,gid=10001"
                self.command(["/bin/mount", "-t", "tmpfs", "-o", f"size={size},nosuid,nodev,{ownership}", "tmpfs", str(path)],
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

    def container_args(self, name, image, mounts, *, entrypoint, grader=False):
        args = [self.settings.docker_binary, "run", "--name", name, "--pull", "never", "--rm", "--init",
                "--label", "org.traceharness.runner=private",
                "--runtime", self.settings.isolation_runtime, "--network", "none", "--read-only", "--user", "0:0" if grader else "10001:10001",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--pids-limit", "256",
                "--memory", "4g", "--cpus", "2", "--ulimit", "fsize=67108864:67108864",
                "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m,mode=1777", "--env", "HOME=/tmp/home",
                "--env", "PYTHONDONTWRITEBYTECODE=1", "--workdir", "/workspace", "--entrypoint", entrypoint]
        if grader:
            # The trusted writer stays root; its evaluated child must drop to
            # uid/gid10002. No other capability or network is granted.
            args += ["--cap-add", "SETUID", "--cap-add", "SETGID"]
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
        artifacts = []
        try:
            with self.bounded_storage(directory):
                try:
                    result = self._execute_bounded(job_id, manifest, directory, cancel, forward)
                except ExecutionError as error:
                    artifacts, _ = self.persist_artifacts(directory, manifest)
                    error.artifacts = artifacts
                    raise
                artifacts, issues = self.persist_artifacts(directory, manifest, grade=result["grade"])
                return {**result, "artifacts": artifacts, "issues": result.get("issues", []) + issues}
        except ExecutionError as error:
            error.artifacts = artifacts
            raise

    def persist_artifacts(self, directory, manifest, *, grade=None):
        artifacts, issues = [], []
        values = {"manifest.json": json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode()}
        if grade is not None:
            values["grade.json"] = json.dumps({"outcome": grade}, sort_keys=True).encode()
        for name in RUNTIME_ARTIFACTS:
            path = directory / "output" / name
            try:
                values[name] = _read_artifact(path)
            except FileNotFoundError:
                continue
            except (OSError, ValueError, UnicodeError):
                issues.append(name + " was not exported because it was not a regular UTF-8 file within the 1 MiB limit.")
        for name, raw in values.items():
            raw = _redacted(raw)
            if len(raw) > ARTIFACT_LIMIT:
                issues.append(name + " exceeded the 1 MiB export limit.")
                continue
            fd = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
            artifacts.append({"name": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
        return artifacts, issues

    def _execute_bounded(self, job_id, manifest, directory: Path, cancel, forward):
        task = self.registry.tasks[manifest["task_id"]]
        source = Path(task["path"])
        if tree_hash(source) != manifest["task_content_sha256"]:
            raise ExecutionError("Task package changed after review.")
        work, inputs, output, gateway = [directory / name for name in ("workspace", "input", "output", "gateway")]
        for path in (inputs, gateway):
            path.mkdir(mode=0o755)
            # The enclosing private job directory remains0700. Bind-mounted leaf
            # directories must remain traversable by the isolated non-root agent
            # even when the control service uses umask0077.
            path.chmod(0o755)
        # On a dedicated Linux host the control service owns mounts for uid10001.
        # No host home, Docker socket, or provider credential is exposed to the task.
        (inputs / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False))
        (inputs / "prompt.txt").write_text(manifest["prompt"])
        (inputs / "issue.md").write_bytes((source / "issue.md").read_bytes())
        try:
            task_metadata = json.loads((source / "task.json").read_text())
            command = task_metadata["visible_test_command"]
            if set(task_metadata) != {"visible_test_command"} or not isinstance(command, str) or not command.strip() or len(command.encode()) > 8192 or "\x00" in command:
                raise ValueError()
        except (OSError, ValueError, KeyError, TypeError):
            raise ExecutionError("Task package has no valid visible test command.") from None
        (inputs / "task.json").write_text(json.dumps({"visible_test_command": command}))
        for path in inputs.iterdir():
            path.chmod(0o444)
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
            entrypoint="/opt/traceharness-grade", grader=True)
        self._run(args, name + "-grade", cancel, deadline)
        grade = grading / "grade.json"
        if grade.is_symlink() or not grade.is_file() or grade.stat().st_size > 65536:
            raise ExecutionError("The trusted grader did not return a bounded result.")
        try:
            result = json.loads(_read_artifact(grade))
        except (OSError, ValueError, UnicodeError):
            raise ExecutionError("The trusted grader returned an invalid result.") from None
        if not isinstance(result, dict) or result.get("outcome") not in {"passed", "failed", "error"}:
            raise ExecutionError("The trusted grader returned an invalid result.")
        return {"grade": result["outcome"],
                "issues": [] if result["outcome"] == "passed" else ["Execution finished; the trusted grader reported " + result["outcome"] + "."]}
