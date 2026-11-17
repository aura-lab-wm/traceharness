"""`traceharness runner setup` and `status`: build the runner's images on this machine and write its registry.

Everything is built here, from files that ship in the wheel, and nothing is pulled from a registry we
publish. The three runtimes (the TraceHarness engine at the installed package version, Claude Code 2.1.322
and Codex 0.167.1) are the `runtime` target of assets/Dockerfile; the grader image is assets/grader.Dockerfile
with the curated task packages' offline grader; the eight task packages are built from their reviewed
recipes (assets/tasks) against pinned upstream archives; and, when their inputs can be fetched, the
native-prompt inventories are generated from the built images. The registry written at the end
(<lab>/data/runner/registry.json) names every image by its local image ID.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import urllib.request

from traceharness.runner_service.registry import Registry, tree_hash

from . import local as L

ASSETS = Path(__file__).resolve().parent / "assets"
NATIVE_ASSETS = ASSETS / "native"

#: id -> pinned CLI version (None: the installed traceharness package version).
RUNTIMES = (("traceharness", None), ("native-claude-code", "2.1.322"), ("native-codex", "0.167.1"))
GRADER_TAG = "traceharness-grader-eight"
#: The models receipts are written for (the three the hosted release verified). Any model the provider lists
#: still runs; a combination without a receipt runs on an explicit "unverified_ok".
DEFAULT_MODELS = ("openai/gpt-4.1-mini", "openai/gpt-5.1-codex-mini", "anthropic/claude-haiku-4.5")
PLATFORM = "linux/amd64"      # the native inventories and the pinned CLIs are x86_64

CLAUDE_BINARY = "/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe"
ACORN_URL = "https://registry.npmjs.org/acorn/-/acorn-8.18.0.tgz"
ACORN_SHA256 = "953573b8fdab71599749ea5f2b33d3e760c2116178f9423ee7458dbe39d59453"      # dist/acorn.mjs
CATALOG_URL = "https://raw.githubusercontent.com/Piebald-AI/tweakcc/2cecd14d243e159ffc964d941f85858b4cc5172e/data/prompts/prompts-2.1.322.json"
CODEX_SOURCE_URL = "https://codeload.github.com/openai/codex/tar.gz/0a94398fa60c4fac0e7659e4213a0a36e613dd46"


class SetupError(Exception):
    """A step failed in a way the user can act on; the message says which and why."""


def image_tag(runtime_id: str) -> str:
    return f"traceharness-{runtime_id}-local"


def package_version() -> str:
    from traceharness.__main__ import __version__
    return __version__


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------------------- docker plumbing
def _stream(command, cwd, logfile: Path, echo=None) -> int:
    """Run a build, keep its full output in `logfile`, and echo only its step lines."""
    with logfile.open("wb") as out:
        process = subprocess.Popen(command, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        for line in process.stdout:
            out.write(line)
            text = line.decode("utf-8", "replace").rstrip()
            if echo and re.match(r"^#\d+ (\[|DONE|ERROR)", text):
                echo("    " + text[:140])
        return process.wait()


def image_id(docker: str, tag: str, run=subprocess.run) -> str:
    done = run([docker, "image", "inspect", "--format", "{{.Id}}", tag], capture_output=True, timeout=30, check=False)
    value = done.stdout.decode().strip() if done.returncode == 0 else ""
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", value):
        raise SetupError(f"Docker has no image {tag}.")
    return value


def stage_context(destination: Path, version: str) -> Path:
    """The build context: this installed package (without the UI build), the task lock and the grader."""
    if destination.exists():
        shutil.rmtree(destination)
    package = Path(__file__).resolve().parents[1]
    shutil.copytree(package, destination / "package" / "traceharness",
                    ignore=shutil.ignore_patterns("frontend", "__pycache__", "*.pyc", "node_modules", ".git"))
    shutil.copyfile(ASSETS / "Dockerfile", destination / "Dockerfile")
    shutil.copyfile(ASSETS / "requirements.lock", destination / "requirements.lock")
    (destination / "grader").mkdir()
    shutil.copyfile(ASSETS / "tasks" / "grade.py", destination / "grader" / "grade.py")
    shutil.copyfile(ASSETS / "grader.Dockerfile", destination / "grader.Dockerfile")
    (destination / "VERSION").write_text(version)
    return destination


def fetch(url: str, destination: Path, sha256: str | None = None, limit: int = 128 * 1024 * 1024) -> str:
    """Download `url` to `destination`; refuse a digest mismatch. Returns the file's SHA-256."""
    request = urllib.request.Request(url, headers={"User-Agent": "traceharness-runner-setup"})
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as out:
        size = 0
        for chunk in iter(lambda: response.read(1 << 20), b""):
            size += len(chunk)
            if size > limit:
                raise SetupError("A download exceeded its size limit.")
            out.write(chunk)
    digest = sha256_file(destination)
    if sha256 and digest != sha256:
        destination.unlink(missing_ok=True)
        raise SetupError("A pinned download did not match its digest.")
    return digest


# --------------------------------------------------------------------------- task packages
def open_permissions(root: Path):
    """The grader runs as root with every capability but SETUID/SETGID dropped (no DAC override), and the
    task is bind-mounted from here, so every directory must be traversable and every file readable by
    everyone whatever umask built them. The content hash covers names and bytes, not modes."""
    for path in [root, *root.rglob("*")]:
        if path.is_symlink():
            continue
        mode = path.stat().st_mode
        path.chmod(0o755 if path.is_dir() or mode & 0o111 else 0o644)


def build_tasks(runner: Path, package, log, *, force=False) -> list[dict]:
    """Package every reviewed recipe under <runner>/tasks/<id>; reuse a package that is already there."""
    rows = []
    for recipe_path in sorted((ASSETS / "tasks").glob("*/recipe.json")):
        recipe = json.loads(recipe_path.read_text())
        target = runner / "tasks" / recipe["id"]
        if target.exists() and force:
            shutil.rmtree(target)
        if not target.exists():
            log(f"  task {recipe['id']}: building from the pinned upstream archive")
            try:
                package(recipe_path, target)
                open_permissions(target)
            except (OSError, ValueError) as error:
                raise SetupError(f"Task {recipe['id']} could not be packaged: {error}") from None
        else:
            open_permissions(target)
            log(f"  task {recipe['id']}: already built")
        rows.append({"recipe": recipe, "path": target})
    if not rows:
        raise SetupError("No task recipes ship with this package.")
    return rows


# --------------------------------------------------------------------------- native prompt inventories
def _container_copy(docker, image, source, destination: Path, run):
    name = "traceharness-extract-" + secrets.token_hex(6)
    created = run([docker, "create", "--name", name, image], capture_output=True, timeout=60, check=False)
    if created.returncode:
        raise SetupError("Could not create a container to read the native binary.")
    try:
        copied = run([docker, "cp", f"{name}:{source}", str(destination)], capture_output=True, timeout=300, check=False)
        if copied.returncode or not destination.is_file():
            raise SetupError("Could not copy the native binary out of its image.")
    finally:
        run([docker, "rm", "--force", name], capture_output=True, timeout=60, check=False)


def native_inventory(runner: Path, docker: str, runtime_id: str, image: str, run, log, fetcher=fetch) -> dict:
    """Generate one native runtime's private prompt inventory from its built image. Returns registry fields."""
    folder = runner / "native" / runtime_id
    folder.mkdir(parents=True, exist_ok=True)
    binary = folder / "pristine"
    inventory = folder / "inventory.private.json"
    binary.unlink(missing_ok=True)
    inventory.unlink(missing_ok=True)
    version = dict(RUNTIMES)[runtime_id]
    if runtime_id == "native-claude-code":
        _container_copy(docker, image, CLAUDE_BINARY, binary, run)
        from traceharness.runner_service import native_prompts_elf as ELF
        raw = binary.read_bytes()
        (folder / "source-graph.bin").write_bytes(ELF.extract_native_source(raw))
        (folder / "source-layout.json").write_text(json.dumps(ELF.native_source_layout(raw)))
        acorn_tgz = folder / "acorn.tgz"
        fetcher(ACORN_URL, acorn_tgz)
        import tarfile
        with tarfile.open(acorn_tgz) as archive:
            member = archive.getmember("package/dist/acorn.mjs")
            (folder / "acorn.mjs").write_bytes(archive.extractfile(member).read())
        if sha256_file(folder / "acorn.mjs") != ACORN_SHA256:
            raise SetupError("The parser dependency did not match its pinned digest.")
        # The catalog is a candidate list; only complete parsed literals in the binary become anchors. Its
        # digest is recorded in the candidates' provenance, not assumed.
        catalog_sha = fetcher(CATALOG_URL, folder / "catalog.json")
        candidates = folder / "parsed-candidates.json"
        candidates.unlink(missing_ok=True)
        user = f"{os.getuid()}:{os.getgid()}" if hasattr(os, "getuid") else "10001:10001"
        parsed = run([docker, "run", "--rm", "--network", "none", "--memory", "4g", "--user", user, "--entrypoint", "node",
                      "-v", f"{folder}:/ws", "-v", f"{NATIVE_ASSETS}:/scripts:ro", image,
                      "/scripts/prepare_native_prompt_inventory.mjs", "/ws/source-graph.bin", "/ws/source-layout.json",
                      "/ws/catalog.json", "/ws/acorn.mjs", "/ws/parsed-candidates.json", version, ACORN_SHA256, catalog_sha],
                     capture_output=True, timeout=1800, check=False)
        if parsed.returncode or not candidates.is_file():
            raise SetupError("The prompt parser did not complete.")
        done = run([sys.executable, str(NATIVE_ASSETS / "finalize_native_prompt_inventory.py"), "--binary", str(binary),
                    "--binary-sha256", sha256_file(binary), "--candidates", str(candidates), "--image-digest", image,
                    "--version", version, "--output", str(inventory)], capture_output=True, timeout=1800, check=False)
    else:
        from traceharness.runner_service import native_prompts_codex as CODEX
        _container_copy(docker, image, CODEX.BINARY_TARGET, binary, run)
        archive = folder / "codex-source.tar.gz"
        archive_sha = fetcher(CODEX_SOURCE_URL, archive, limit=100 * 1024 * 1024)
        done = run([sys.executable, str(NATIVE_ASSETS / "prepare_codex_prompt_inventory.py"), "--binary", str(binary),
                    "--source-archive", str(archive), "--archive-sha256", archive_sha, "--output", str(inventory),
                    "--image-digest", image], capture_output=True, timeout=1800, check=False)
    if done.returncode or not inventory.is_file():
        raise SetupError("The prompt inventory could not be generated.")
    for name in ("source-graph.bin", "source-layout.json", "acorn.tgz", "acorn.mjs", "catalog.json", "parsed-candidates.json", "codex-source.tar.gz"):
        (folder / name).unlink(missing_ok=True)
    rel = f"native/{runtime_id}"
    return {"native_prompt_inventory": {"path": f"{rel}/inventory.private.json", "sha256": sha256_file(inventory)},
            "native_prompt_binary": {"path": f"{rel}/pristine", "sha256": sha256_file(binary)},
            "native_prompt_receipts": []}


# --------------------------------------------------------------------------- registry
def registry_data(runtimes: dict, tasks: list[dict], grader: str, models=DEFAULT_MODELS, previous: dict | None = None) -> dict:
    """The registry JSON. `runtimes` maps id -> {version, image_digest, [native_prompt_*]}."""
    receipts = {}
    for row in (previous or {}).get("runtimes", []):
        receipts[row["id"]] = (row.get("image_digest"), row.get("compatibility_receipts", []))
    runtime_rows = []
    for rid, row in runtimes.items():
        kept = receipts.get(rid)
        # A receipt binds one exact image; a rebuilt image keeps none of them.
        compat = kept[1] if kept and kept[0] == row["image_digest"] else []
        runtime_rows.append({"id": rid, **row, "compatibility_receipts": compat})
    task_rows = []
    for item in tasks:
        recipe = item["recipe"]
        task_rows.append({"id": recipe["id"], "title": recipe["title"], "repository": recipe["repository"],
                          "revision": recipe["revision"], "path": "tasks/" + recipe["id"],
                          "content_sha256": tree_hash(item["path"]), "grader_image_digest": grader,
                          "runtime_ids": list(runtimes), "environment_digests": {rid: r["image_digest"] for rid, r in runtimes.items()}})
    kept_models = list((previous or {}).get("models", []))
    known = {m["id"] for m in kept_models}
    kept_models += [{"id": m, "name": m} for m in models if m not in known]
    return {"version": 1, "models": kept_models, "runtimes": runtime_rows, "tasks": task_rows}


def write_registry(runner: Path, data: dict) -> Path:
    Registry(runner, data, local=True)          # validates every path, digest and binding before it is saved
    path = runner / "registry.json"
    temporary = path.with_name("registry.json.tmp-" + secrets.token_hex(6))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write((json.dumps(data, indent=2, sort_keys=True) + "\n").encode())
    os.replace(temporary, path)
    return path


# --------------------------------------------------------------------------- setup
def setup(lab_root, *, log=print, run=subprocess.run, stream=_stream, package=None, native=True, force=False,
          fetcher=fetch, docker=None) -> dict:
    """Build the images, task packages and (best effort) native inventories, then write the registry."""
    docker = docker or L.find_docker()
    if not docker:
        raise SetupError("Docker is not installed. Install Docker, start it, and run this again.")
    info = L.docker_info(docker, run)
    if info is None:
        raise SetupError("Docker does not answer. Start Docker, then run this again.")
    isolation = L.detect_isolation(info)
    log(f"Docker answers; jobs will isolate with {isolation}"
        + ("" if isolation == "runsc" else " (gVisor is not installed here; plain Docker with the same limits: no network, read-only task mounts, memory, CPU, process and time limits)"))
    runner = L.runner_dir(lab_root)
    runner.mkdir(parents=True, exist_ok=True)
    runner.chmod(0o700)
    if package is None:
        from .package_task import package as package_recipe
        package = package_recipe
    version = package_version()
    build = runner / "build"
    build.mkdir(exist_ok=True)
    context = stage_context(build / "context", version)

    images = {}
    for rid, pinned in RUNTIMES:
        runtime_version = pinned or version
        tag = image_tag(rid)
        log(f"Building {tag} ({rid} {runtime_version}); the first build downloads the CLIs and takes a while")
        command = [docker, "build", "--platform", PLATFORM, "--target", "runtime", "-t", tag, "--build-arg", f"RUNTIME_ID={rid}",
                   "--build-arg", f"RUNTIME_VERSION={runtime_version}", "--build-arg", f"PACKAGE_VERSION={version}",
                   "-f", "Dockerfile", "."]
        code = stream(command, str(context), build / f"{rid}.log", log)
        if code:
            raise SetupError(f"The {rid} image did not build (exit {code}). Full output: {build / (rid + '.log')}")
        images[rid] = {"version": runtime_version, "image_digest": image_id(docker, tag, run)}
    log(f"Building {GRADER_TAG} (the offline grader for the eight task packages)")
    code = stream([docker, "build", "--platform", PLATFORM, "-t", GRADER_TAG, "-f", "grader.Dockerfile", "."], str(context),
                  build / "grader.log", log)
    if code:
        raise SetupError(f"The grader image did not build (exit {code}). Full output: {build / 'grader.log'}")
    grader = image_id(docker, GRADER_TAG, run)

    log("Packaging the eight task recipes")
    tasks = build_tasks(runner, package, log, force=force)

    notes = []
    if native:
        for rid in ("native-claude-code", "native-codex"):
            log(f"Generating the {rid} prompt inventory from its image")
            try:
                images[rid].update(native_inventory(runner, docker, rid, images[rid]["image_digest"], run, log, fetcher))
            except (SetupError, OSError, ValueError, subprocess.SubprocessError) as error:
                notes.append(f"{rid}: prompt inventory skipped ({error})")
                log(f"  skipped: {error}. Native runs still work; prompt editing for {rid} stays unavailable.")
    previous = None
    existing = runner / "registry.json"
    if existing.is_file():
        try:
            previous = json.loads(existing.read_text())
        except ValueError:
            previous = None
    data = registry_data(images, tasks, grader, previous=previous)
    path = write_registry(runner, data)
    shutil.rmtree(context, ignore_errors=True)
    log(f"Registry written: {path}")
    return {"registry": str(path), "isolation_runtime": isolation, "images": {rid: row["image_digest"] for rid, row in images.items()},
            "grader": grader, "tasks": [t["recipe"]["id"] for t in tasks], "notes": notes}


# --------------------------------------------------------------------------- status
def status(lab_root, *, run=subprocess.run) -> dict:
    """Readiness as plain data: Docker, isolation, images, registry, and which combinations have receipts."""
    docker = L.find_docker()
    info = L.docker_info(docker, run)
    runner = L.runner_dir(lab_root)
    result = {"docker": info is not None, "docker_binary": docker,
              "isolation_runtime": L.detect_isolation(info) if info is not None else None,
              "registry": None, "images": {}, "receipts": [], "unverified": [], "ready": False}
    path = L.registry_path(lab_root)
    if not path.is_file():
        result["registry"] = "missing (run traceharness runner setup)"
        return result
    try:
        registry = Registry.load(path, local=True)
    except (OSError, ValueError, KeyError, TypeError) as error:
        result["registry"] = f"invalid ({error})"
        return result
    result["registry"] = "valid"
    rows = {rid: row["image_digest"] for rid, row in registry.runtimes.items()}
    rows["grader"] = next(iter(registry.tasks.values()))["grader_image_digest"] if registry.tasks else None
    for name, digest in rows.items():
        present = False
        if info is not None and digest:
            done = run([docker, "image", "inspect", "--format", "{{.Id}}", digest], capture_output=True, timeout=30, check=False)
            present = done.returncode == 0 and done.stdout.decode().strip() == digest
        result["images"][name] = {"image": digest, "present": present}
    for rid, row in registry.runtimes.items():
        for mid in registry.models:
            have = [tid for tid in registry.tasks if registry.compatible(rid, mid, tid)]
            if have:
                result["receipts"].append({"runtime": rid, "model": mid, "tasks": have})
            else:
                result["unverified"].append({"runtime": rid, "model": mid})
    result["ready"] = bool(info is not None and registry.runtimes and registry.tasks
                           and all(v["present"] for v in result["images"].values()))
    return result
