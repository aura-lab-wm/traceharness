"""Operator-owned pinned inventory. Empty inventory is deliberately not runnable."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

from .configuration import RUNTIME_NAMES, has_secret

IMAGE = re.compile(r"^(?:[a-zA-Z0-9][a-zA-Z0-9./:_-]*@)?sha256:[a-f0-9]{64}$")
ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$")
COMPATIBILITY_FIELDS = ("runtime_id", "runtime_version", "image_digest", "model_id", "task_id",
                        "task_revision", "task_content_sha256", "grader_image_digest")


def compatibility_identity(runtime: dict, task: dict, model_id: str) -> tuple:
    """Every input whose replacement invalidates an execution receipt."""
    return (runtime["id"], runtime["version"], runtime["image_digest"], model_id, task["id"],
            task["revision"], task["content_sha256"], task["grader_image_digest"])


def tree_hash(directory: Path) -> str:
    """Hash names and contents; reject symlinks and special files, never follow them."""
    if directory.is_symlink():
        raise ValueError("Task packages cannot be symlinks")
    root = directory.resolve(strict=True)
    total, entries = 0, 0
    value = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("Task packages cannot contain symlinks")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError("Task packages must contain regular files")
        entries += 1
        size = path.stat().st_size
        total += size
        if entries > 100000 or total > 2 * 1024**3:
            raise ValueError("Task package exceeds the inventory limit")
        name = path.relative_to(root).as_posix().encode()
        value.update(len(name).to_bytes(8, "big") + name + size.to_bytes(8, "big"))
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                value.update(chunk)
    return value.hexdigest()


class Registry:
    def __init__(self, root: Path, data: dict | None = None):
        self.root = Path(root).resolve()
        data = data or {"version": 1, "runtimes": [], "models": [], "tasks": []}
        if data.get("version") != 1 or has_secret(data):
            raise ValueError("Invalid runner inventory")
        self.runtimes, self.tasks, self.models = {}, {}, {}
        self._compatibility = set()
        for model in data.get("models", []):
            mid = model.get("id")
            if not isinstance(mid, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9/_.:@+-]{1,150}", mid) or mid.startswith("mock") or mid in self.models:
                raise ValueError("Invalid or duplicate model")
            self.models[mid] = {"id": mid, "name": str(model.get("name", mid))[:200]}
        for source in data.get("runtimes", []):
            row = dict(source)
            rid = row.get("id")
            if rid not in RUNTIME_NAMES or rid in self.runtimes or not IMAGE.fullmatch(row.get("image_digest", "")):
                raise ValueError("Runtime needs a unique identity and pinned image digest")
            if not re.fullmatch(r"[A-Za-z0-9_.+-]{1,80}", row.get("version", "")):
                raise ValueError("Runtime needs an exact version")
            row.update(name=RUNTIME_NAMES[rid], kind="traceharness" if rid == "traceharness" else "native",
                       prompt_mode="replace" if rid == "traceharness" else "append", supports_advanced=rid == "traceharness")
            row["model_ids"] = []
            self.runtimes[rid] = row
        for source in data.get("tasks", []):
            row = dict(source)
            tid = row.get("id")
            if not isinstance(tid, str) or not ID.fullmatch(tid) or tid in self.tasks:
                raise ValueError("Invalid or duplicate task identity")
            if not re.fullmatch(r"[a-f0-9]{40}|[a-f0-9]{64}", row.get("revision", "")):
                raise ValueError("Task revision must be immutable")
            if not IMAGE.fullmatch(row.get("grader_image_digest", "")):
                raise ValueError("Task environment and grader must be pinned images")
            if not isinstance(row.get("repository"), str) or not row["repository"].startswith("https://"):
                raise ValueError("Task repository must be an HTTPS provenance URL")
            if not isinstance(row.get("title"), str) or not row["title"].strip() or len(row["title"]) > 200:
                raise ValueError("Task needs a bounded title")
            path = self.private_path(row.get("path", ""))
            if not path.is_dir() or not (path / "repo").is_dir() or not (path / "issue.md").is_file():
                raise ValueError("Task package needs a repository and instructions")
            if not re.fullmatch(r"[a-f0-9]{64}", row.get("content_sha256", "")):
                raise ValueError("Task content needs a pinned digest")
            runtime_ids = row.get("runtime_ids")
            if (not isinstance(runtime_ids, list) or not runtime_ids or len(runtime_ids) > len(RUNTIME_NAMES)
                    or any(not isinstance(r, str) or r not in self.runtimes for r in runtime_ids)
                    or len(set(runtime_ids)) != len(runtime_ids)):
                raise ValueError("Task must name installed runtime environments")
            # Each engine can supply its own pinned dependency environment for the
            # same upstream task. Legacy single-image inventories remain valid.
            environments = row.get("environment_digests")
            if environments is None:
                environments = {rid: row.get("environment_digest", "") for rid in runtime_ids}
            if (not isinstance(environments, dict) or set(environments) != set(runtime_ids)
                    or any(not isinstance(image, str) or not IMAGE.fullmatch(image)
                           or self.runtimes[rid]["image_digest"] != image for rid, image in environments.items())):
                raise ValueError("Runtime image must match the tested task environment")
            row["environment_digests"] = dict(environments)
            row["environment_digest"] = next(iter(environments.values()))
            row["path"] = str(path)
            row["runtime_ids"] = list(runtime_ids)
            self.tasks[tid] = row
        # Validate only after both sides of each receipt are installed. A runtime
        # and model success on one task never attests another task or grader.
        for rid, row in self.runtimes.items():
            receipts = row.get("compatibility_receipts", [])
            if not isinstance(receipts, list):
                raise ValueError("Compatibility receipts must be a list")
            for receipt in receipts:
                if not isinstance(receipt, dict):
                    raise ValueError("Invalid compatibility receipt reference")
                path = self.private_path(receipt.get("path", ""))
                raw = path.read_bytes()
                if hashlib.sha256(raw).hexdigest() != receipt.get("sha256"):
                    raise ValueError("Compatibility receipt changed")
                result = json.loads(raw)
                if not isinstance(result, dict):
                    raise ValueError("Invalid compatibility receipt")
                mid, tid = result.get("model_id"), result.get("task_id")
                task = self.tasks.get(tid) if isinstance(tid, str) else None
                if (result.get("status") != "passed" or not isinstance(mid, str) or mid not in self.models
                        or not task or rid not in task["runtime_ids"]
                        or tuple(result.get(key) for key in COMPATIBILITY_FIELDS) != compatibility_identity(row, task, mid)
                        or not result.get("verified_at") or not result.get("run_id")):
                    raise ValueError("Compatibility receipt does not bind this runtime/model/image/task/grader")
                self._compatibility.add(compatibility_identity(row, task, mid))
                if mid not in row["model_ids"]:
                    row["model_ids"].append(mid)

    @classmethod
    def load(cls, path: Path):
        path = Path(path)
        return cls(path.parent, json.loads(path.read_text()))

    def private_path(self, relative: str) -> Path:
        if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
            raise ValueError("Inventory paths must be relative")
        candidate = self.root / relative
        # Reject symlinks even when they currently resolve inside the inventory root.
        parts = Path(relative).parts
        if ".." in parts or any(self.root.joinpath(*parts[:i]).is_symlink() for i in range(1, len(parts) + 1)):
            raise ValueError("Inventory paths cannot use symlinks")
        path = candidate.resolve(strict=True)
        if not path.is_relative_to(self.root) or path == self.root:
            raise ValueError("Inventory path escapes its root")
        return path

    def task_health(self) -> dict[str, bool]:
        result = {}
        for tid, task in self.tasks.items():
            try:
                metadata = json.loads((Path(task["path"]) / "task.json").read_text())
                command = metadata.get("visible_test_command") if isinstance(metadata, dict) else None
                result[tid] = bool(isinstance(command, str) and command.strip() and len(command) <= 4096
                                   and "\x00" not in command and tree_hash(Path(task["path"])) == task["content_sha256"])
            except (OSError, ValueError):
                result[tid] = False
        return result

    def compatible(self, runtime_id: str, model_id: str, task_id: str) -> bool:
        runtime, task = self.runtimes.get(runtime_id), self.tasks.get(task_id)
        return bool(runtime and task and runtime_id in task["runtime_ids"]
                    and compatibility_identity(runtime, task, model_id) in self._compatibility)

    def ready_combinations(self, health: dict, model_ids=None) -> dict[str, dict[str, list[str]]]:
        """Exact receipts intersected with current task, image and provider health."""
        active = set(self.models if model_ids is None else model_ids)
        return {tid: {rid: sorted(mid for mid in self.runtimes[rid]["model_ids"]
                                 if mid in active and self.compatible(rid, mid, tid))
                      if health.get("available") and health.get("tasks", {}).get(tid)
                      and health.get("runtimes", {}).get(rid) else []
                      for rid in task["runtime_ids"]} for tid, task in self.tasks.items()}

    def catalog(self, health: dict, models: list[dict] | None = None) -> dict:
        combinations = self.ready_combinations(health, None if models is None else [row["id"] for row in models])
        runtimes = []
        for rid, name in RUNTIME_NAMES.items():
            row = self.runtimes.get(rid, {})
            ready_models = sorted({mid for task in combinations.values() for mid in task.get(rid, [])})
            available = bool(ready_models)
            runtimes.append({"id": rid, "name": name, "kind": "traceharness" if rid == "traceharness" else "native",
                             "available": available, "reason": "" if available else "No verified, isolated runtime is available.",
                             "version": row.get("version"), "image_digest": row.get("image_digest"),
                             "prompt_mode": "replace" if rid == "traceharness" else "append", "supports_advanced": rid == "traceharness",
                             "model_ids": ready_models})
        tasks = [{**{k: task[k] for k in ("id", "title", "repository", "revision", "environment_digest")},
                  "runtime_ids": list(task["runtime_ids"]), "environment_digests": dict(task["environment_digests"]),
                  "model_ids_by_runtime": combinations[tid], "ready": any(combinations[tid].values()),
                  "reason": "" if any(combinations[tid].values()) else "No verified task/runtime/model combination is currently available."}
                 for tid, task in self.tasks.items()]
        available = any(task["ready"] for task in tasks)
        return {"version": 1, "runner": {"available": available, "message": "Private runner ready." if available else "No verified runtime and task environment are connected."},
                "runtimes": runtimes, "models": models or [], "tasks": tasks,
                "credentials_available": available, "execution_available": available}
