"""Operator-owned pinned inventory. Empty inventory is deliberately not runnable."""
from __future__ import annotations

import hashlib
import copy
import json
from pathlib import Path
import re

from .configuration import RUNTIME_NAMES, has_secret, canonical

IMAGE = re.compile(r"^(?:[a-zA-Z0-9][a-zA-Z0-9./:_-]*@)?sha256:[a-f0-9]{64}$")
ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$")
COMPATIBILITY_FIELDS = ("runtime_id", "runtime_version", "image_digest", "model_id", "task_id",
                        "task_revision", "task_content_sha256", "grader_image_digest")
NATIVE_PROMPT_FIELDS = ("runtime_id", "runtime_version", "image_digest", "binary_sha256", "inventory_sha256",
                        "taxonomy_sha256", "materializer_sha256")
NATIVE_PROMPT_CHECKS = ("application_verified", "baseline_verified", "noop_verified", "changed_verified")
NATIVE_PROMPT_ADAPTERS = frozenset({"native-claude-code", "native-codex"})


def native_prompt_adapter(runtime_id):
    if runtime_id == "native-codex":
        from . import native_prompts_codex
        return native_prompts_codex
    from . import native_prompts
    return native_prompts


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
        self.native_prompt_inventories, self._native_prompt_admissions = {}, {}
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
        for rid, row in self.runtimes.items():
            reference = row.get("native_prompt_inventory")
            receipts = row.get("native_prompt_receipts", [])
            if not isinstance(receipts, list) or len(receipts) > 32:
                raise ValueError("Invalid native prompt receipts")
            if reference is None:
                if receipts:
                    raise ValueError("Native prompt receipt requires its exact inventory")
                continue
            if row["kind"] != "native":
                raise ValueError("Native prompt inventory requires a native runtime")
            from .native_prompts import taxonomy_sha256
            adapter = native_prompt_adapter(rid)
            inventory = adapter.validate_inventory(self._pinned_json(reference, 16 * 1024 * 1024), require_private=True)
            if any(inventory.get(key) != value for key, value in {"runtime_id": rid, "runtime_version": row["version"], "image_digest": row["image_digest"]}.items()):
                raise ValueError("Native prompt inventory does not bind this runtime")
            if inventory["materializer_sha256"] != adapter.materializer_sha256():
                raise ValueError("Native prompt materializer changed")
            if inventory["taxonomy_sha256"] != taxonomy_sha256():
                raise ValueError("Native prompt taxonomy changed")
            binary = row.get("native_prompt_binary")
            if (not isinstance(binary, dict) or set(binary) != {"path", "sha256"}
                    or binary.get("sha256") != inventory["binary_sha256"]):
                raise ValueError("Native prompt binary must bind the exact inventory")
            binary_path = self.private_path(binary["path"])
            if not binary_path.is_file() or not 0 < binary_path.stat().st_size <= 512 * 1024 * 1024:
                raise ValueError("Native prompt binary must be a bounded regular file")
            binary_hash = hashlib.sha256()
            with binary_path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    binary_hash.update(chunk)
            if binary_hash.hexdigest() != binary["sha256"]:
                raise ValueError("Native prompt binary changed")
            row["native_prompt_binary"] = {"path": str(binary_path), "sha256": binary["sha256"]}
            if len(canonical(adapter.public_inventory(inventory))) > 4 * 1024 * 1024 - 4096:
                raise ValueError("Native prompt inventory exceeds the member response limit")
            self.native_prompt_inventories[rid] = copy.deepcopy(inventory)
            for receipt in receipts:
                if rid not in NATIVE_PROMPT_ADAPTERS:
                    raise ValueError("Native prompt runtime has no installed application adapter")
                proof = self._pinned_json(receipt, 64 * 1024)
                required = {"schema_version", "status", "verified_at", "run_id", *NATIVE_PROMPT_FIELDS, *NATIVE_PROMPT_CHECKS}
                if (set(proof) != required or type(proof.get("schema_version")) is not int or proof["schema_version"] != 1
                        or proof.get("status") != "operationally_verified"
                        or any(proof.get(key) != inventory.get(key) for key in NATIVE_PROMPT_FIELDS)
                        or any(proof.get(key) is not True for key in NATIVE_PROMPT_CHECKS)
                        or any(not isinstance(proof.get(key), str) or not proof[key] or len(proof[key]) > 200 for key in ("verified_at", "run_id"))):
                    raise ValueError("Native prompt application receipt does not bind this inventory")
                if rid in self._native_prompt_admissions:
                    raise ValueError("Duplicate native prompt application receipt")
                self._native_prompt_admissions[rid] = {"schema_version": 1, "receipt_sha256": receipt["sha256"],
                    "cohort": "verified_base_runtime_model_task", **{key: proof[key] for key in NATIVE_PROMPT_FIELDS}}

    def _pinned_json(self, reference, maximum):
        if (not isinstance(reference, dict) or set(reference) != {"path", "sha256"}
                or not isinstance(reference.get("sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", reference["sha256"])):
            raise ValueError("Invalid pinned native prompt reference")
        path = self.private_path(reference["path"])
        if not path.is_file() or path.stat().st_size > maximum:
            raise ValueError("Invalid pinned native prompt file")
        raw = path.read_bytes()
        if len(raw) > maximum or hashlib.sha256(raw).hexdigest() != reference["sha256"]:
            raise ValueError("Pinned native prompt file changed")
        result = json.loads(raw)
        if not isinstance(result, dict) or has_secret(result):
            raise ValueError("Invalid pinned native prompt object")
        return result

    def native_prompt_profile(self, runtime_id, profile):
        from .native_prompts import taxonomy_sha256
        adapter = native_prompt_adapter(runtime_id)
        inventory = self.native_prompt_inventories.get(runtime_id)
        admission = self._native_prompt_admissions.get(runtime_id)
        runtime = self.runtimes.get(runtime_id)
        if (runtime_id not in NATIVE_PROMPT_ADAPTERS or not inventory or not admission or not runtime
                or inventory["runtime_version"] != runtime["version"] or inventory["image_digest"] != runtime["image_digest"]):
            raise ValueError("Native prompt application is unavailable")
        if inventory["materializer_sha256"] != adapter.materializer_sha256() or inventory["taxonomy_sha256"] != taxonomy_sha256():
            raise ValueError("Native prompt adapter or taxonomy changed")
        # This receipt establishes the application mechanism, never the treatment's
        # task grade. Existing exact base runtime/model/task compatibility still gates preflight.
        return adapter.canonical_profile(profile, inventory), copy.deepcopy(admission)

    def native_prompt_catalog(self, runtime_id, health):
        inventory = self.native_prompt_inventories.get(runtime_id)
        available = inventory is not None
        adapter = native_prompt_adapter(runtime_id)
        coherent = bool(available and inventory.get("materializer_sha256") == adapter.materializer_sha256())
        executable = bool(coherent and runtime_id in NATIVE_PROMPT_ADAPTERS and runtime_id in self._native_prompt_admissions
                          and health.get("available") and health.get("runtimes", {}).get(runtime_id))
        return {"available": available, "execution_available": executable,
                "mode": "embedded" if runtime_id == "native-claude-code" or available else "overlay",
                "inventory_sha256": inventory["inventory_sha256"] if available else None,
                "reason": "" if executable else "Native prompt application has no verified mechanism or ready base combination." if available else "Inventory unavailable for this runtime version."}

    def native_prompt_inventory(self, runtime_id, health):
        adapter = native_prompt_adapter(runtime_id)
        capability = self.native_prompt_catalog(runtime_id, health)
        inventory = self.native_prompt_inventories.get(runtime_id)
        return {"version": 1, "available": capability["available"], "reason": capability["reason"],
                "execution_available": capability["execution_available"],
                "inventory": adapter.public_inventory(copy.deepcopy(inventory)) if inventory is not None else None}

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
                             "model_ids": ready_models,
                             **({"native_prompts": self.native_prompt_catalog(rid, health)} if rid != "traceharness" else {})})
        tasks = [{**{k: task[k] for k in ("id", "title", "repository", "revision", "environment_digest")},
                  "runtime_ids": list(task["runtime_ids"]), "environment_digests": dict(task["environment_digests"]),
                  "model_ids_by_runtime": combinations[tid], "ready": any(combinations[tid].values()),
                  "reason": "" if any(combinations[tid].values()) else "No verified task/runtime/model combination is currently available."}
                 for tid, task in self.tasks.items()]
        available = any(task["ready"] for task in tasks)
        return {"version": 1, "runner": {"available": available, "message": "Private runner ready." if available else "No verified runtime and task environment are connected."},
                "runtimes": runtimes, "models": models or [], "tasks": tasks,
                "credentials_available": available, "execution_available": available}
