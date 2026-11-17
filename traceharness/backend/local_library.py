"""The harness library on this computer: the hosted member save rules, with one owner (SPEC 3(b), 4.5).

Callers: backend/shallow_api.py (the routes) and backend/local_runner_api.py (`read_json`,
`refuse_secrets`, `LibraryError`). The library is a `shallow.store.FileStore` under
`<lab>/data/harness-library`, owner id `local`. It holds harness configurations only: never a key,
never a run (runs are written by the lab's own job runner under data/runs).

Fixed harnesses use the conflict-safe protocol of SPEC 4.5: a save names exactly one precondition,
`if_hash` (the 12-hex hash of the copy the client loaded) or `if_absent: true` (the client loaded no
copy), and is refused with 409 when the copy on disk no longer matches. Minimal harnesses are
content-addressed (`min_` + the compiler's hash), so they need no precondition. Every
read-modify-write of the library runs under one process lock.
"""
from __future__ import annotations

import json
import os
import re
import threading

from traceharness.core.blocks import compile_blocks
from traceharness.core.harness import content_hash
from traceharness.runner_service.configuration import has_secret
from traceharness.shallow import wizard
from traceharness.shallow.catalog import AGENTS, PERMISSION, card, catalog
from traceharness.shallow.identity import clip_prompt, shallow_hash
from traceharness.shallow.store import FileStore, StoreError

from . import paths

OWNER = "local"
SAFE_ID = re.compile(r"^[A-Za-z0-9_.@-]{1,80}$")
MINIMAL_ID = re.compile(r"^min_[a-f0-9]{12}$")
HASH = re.compile(r"^[a-f0-9]{12}$")
BLOCK_TYPES = ("prompt", "tools", "policy", "context", "stop", "sampling", "listing")
MAX_BODY = 1024 * 1024
CONFLICT = "This prompt changed on this computer. Reload and review it before saving."
NOT_FOUND = "Not found."

#: One lock around every read-modify-write of the library (the server runs routes on a thread pool).
LOCK = threading.Lock()


class LibraryError(ValueError):
    """A refusal with the HTTP status the route answers."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def library_root() -> str:
    """Read at call time, so the root follows the lab the server was started on."""
    return os.path.join(paths.DATA_ROOT, "harness-library")


def _store() -> FileStore:
    return FileStore(library_root())


# --------------------------------------------------------------------------- request bodies
def _no_constants(name):
    raise ValueError(f"{name} is not JSON")


async def read_json(request) -> dict:
    """The request body as a JSON object of at most 1 MiB, or a LibraryError (413 / 400)."""
    declared = request.headers.get("content-length")
    if declared is not None:
        if not declared.strip().isdigit():
            raise LibraryError("The request has an invalid Content-Length.")
        if int(declared) > MAX_BODY:
            raise LibraryError("The request body is larger than 1 MiB.", 413)
    raw = bytearray()
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > MAX_BODY:
            raise LibraryError("The request body is larger than 1 MiB.", 413)
    try:
        data = json.loads(bytes(raw).decode("utf-8"), parse_constant=_no_constants) if raw else {}
    except (ValueError, RecursionError):
        raise LibraryError("The request body must be a JSON object.") from None
    if not isinstance(data, dict):
        raise LibraryError("The request body must be a JSON object.")
    return data


def refuse_secrets(value) -> None:
    """A key-named field or a key-shaped string anywhere in a body is refused, never stored."""
    try:
        found = has_secret(value)
    except RecursionError:
        found = True
    if found:
        raise LibraryError("Remove the key from this request. Harnesses and runs on this computer never carry one.")


# --------------------------------------------------------------------------- compile
def _read_only_warnings(tools: list, prompt: str, policy: str) -> list[str]:
    """The two wrapper warnings the hosted compiler adds for a read-only tool set."""
    out = []
    if not any(t in tools for t in ("edit_file", "write_file", "run_tests", "bash")):
        if "verify" in prompt:
            out.append(wizard._READ_ONLY_VERIFY)
        if policy == "permissive":
            out.append(wizard._READ_ONLY_PERMISSIVE)
    return out


def _hosted(harness: dict, digest: str, warnings: list) -> dict:
    """The hosted compile answer: the `min_` stamp plus the fields the console's record check needs."""
    harness = dict(harness)
    harness["prompt"] = harness["system_prompt"]
    harness["include_in_vendor_ladder"] = False
    harness["permission"] = PERMISSION
    return {"ok": True, "hash": digest, "mcp": "none", "warnings": list(dict.fromkeys(warnings)), "harness": harness}


def stamp_minimal(compiled: dict) -> dict:
    """A successful `compile_blocks` result stamped exactly as `wizard.compile_minimal` stamps it."""
    digest = compiled["hash"]
    harness = dict(compiled["harness"])
    harness["id"] = "min_" + digest
    harness["notes"] = "minimal wizard"
    if content_hash(harness) != digest:
        raise RuntimeError("stamping min_ changed the cell")
    harness["mcp"] = "none"
    harness["lane"] = "minimal"
    harness["cap_bytes"] = 20_000
    return harness


def compile_seven(blocks) -> dict:
    """The hosted seven-block rule: each type once, each a JSON object, then the lab compiler."""
    if not isinstance(blocks, list) or len(blocks) != len(BLOCK_TYPES):
        raise LibraryError("Supply all seven wizard blocks.")
    seen = set()
    for block in blocks:
        if not isinstance(block, dict) or block.get("type") not in BLOCK_TYPES or block.get("type") in seen:
            raise LibraryError("Unknown or duplicate block.")
        seen.add(block["type"])
    try:
        compiled = compile_blocks(blocks)
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        raise LibraryError(str(error) or "The blocks could not be compiled.") from None
    if not compiled["ok"]:
        raise LibraryError(compiled["errors"][0] if compiled["errors"] else "The blocks could not be compiled.")
    harness = stamp_minimal(compiled)
    by_type = {b["type"]: b for b in blocks}
    warnings = list(compiled["warnings"]) + _read_only_warnings(
        harness["tools"], harness["system_prompt"], by_type["policy"]["mode"])
    return _hosted(harness, compiled["hash"], warnings)


def compile_answers(answers) -> dict:
    """The six wizard answers through `wizard.compile_minimal` (absent answers = recommended)."""
    if answers is not None and not isinstance(answers, dict):
        raise LibraryError("Answers must be an object.")
    try:
        result = wizard.compile_minimal(answers)
    except (ValueError, TypeError, KeyError) as error:
        raise LibraryError(str(error) or "Answer all six questions.") from None
    if not result.get("ok"):
        raise LibraryError((result.get("errors") or ["The answers could not be compiled."])[0])
    return _hosted(result["harness"], result["hash"], result["warnings"])


def compile_request(body: dict) -> dict:
    """POST /compile and /wizard: `{blocks}` wins over `{answers}`, as on the hosted side."""
    if "blocks" in body:
        return compile_seven(body["blocks"])
    return compile_answers(body.get("answers"))


def blocks_for_record(record: dict) -> list[dict]:
    """The seven blocks a saved minimal record was compiled from (the hosted `blocksForRecord`)."""
    if record.get("mcp", "none") != "none" or record.get("lane", "minimal") != "minimal":
        raise LibraryError("This is not a minimal harness with MCP off.")
    if record.get("cap_bytes", 20000) != 20000:
        raise LibraryError("Minimal harnesses have a 20000 byte cap.")
    if "prompt" in record and "system_prompt" in record and record["prompt"] != record["system_prompt"]:
        raise LibraryError("The prompt fields disagree.")
    return [
        {"type": "prompt", "text": record.get("prompt", record.get("system_prompt"))},
        {"type": "tools", "names": record.get("tools")},
        {"type": "policy", "mode": record.get("policy")},
        {"type": "context", "window": record.get("context_window", 0), "observation_chars": record.get("observation_chars", 6000)},
        {"type": "stop", "max_steps": record.get("max_steps"), "max_total_tokens": record.get("max_total_tokens", 400000)},
        {"type": "sampling", "temperature": record.get("temperature", 0), "max_tokens_per_call": record.get("max_tokens_per_call", 2048)},
        {"type": "listing", "include": record.get("include_file_listing", True)},
    ]


# --------------------------------------------------------------------------- reads
def catalog_cards() -> list[dict]:
    return catalog()


def _fixed_row(row: dict):
    """A stored fixed copy as served: the catalog card with the stored prompt, clipped and rehashed."""
    hid = row.get("id")
    if hid not in AGENTS or not isinstance(row.get("prompt"), str):
        return None
    base = card(hid)
    prompt = clip_prompt(row["prompt"], base["cap_bytes"])
    return {**base, "prompt": prompt, "hash": shallow_hash(hid, prompt, base["cap_bytes"])}


def _served(row: dict):
    if not isinstance(row, dict):
        return None
    if row.get("lane") == "fixed":
        return _fixed_row(row)
    if (row.get("lane") == "minimal" and MINIMAL_ID.fullmatch(str(row.get("id", "")))
            and isinstance(row.get("prompt"), str) and isinstance(row.get("tools"), list)):
        return row
    return None


def list_saved() -> dict:
    try:
        rows = _store().list_harnesses(OWNER)
    except (StoreError, OSError):
        raise LibraryError("The harness library on this computer could not be read.", 503) from None
    served = [r for r in (_served(row) for row in rows) if r is not None]
    return {"harnesses": served, "loaded": True, "unconfirmed": []}


def get_saved(harness_id: str) -> dict:
    if not isinstance(harness_id, str) or not SAFE_ID.fullmatch(harness_id):
        raise LibraryError(NOT_FOUND, 404)
    try:
        row = _store().get_harness(OWNER, harness_id)
    except (StoreError, OSError):
        raise LibraryError(NOT_FOUND, 404) from None
    row = _served(row) if row is not None else None
    if row is None:
        raise LibraryError(NOT_FOUND, 404)
    if row["lane"] == "minimal":
        try:
            built = compile_seven(blocks_for_record(row))
        except LibraryError:
            built = None
        if built is None or built["harness"]["id"] != row["id"]:
            raise LibraryError("This saved harness failed validation. Recreate it with the wizard.", 409)
        return {"harness": built["harness"]}
    return {"harness": row}


# --------------------------------------------------------------------------- writes
def _write(record: dict) -> dict:
    try:
        return _store().save_harness(OWNER, record)
    except (StoreError, OSError):
        raise LibraryError("The harness library on this computer could not be written.", 503) from None


def save_fixed(body: dict) -> dict:
    """SPEC 4.5: exactly one of `if_hash` and `if_absent: true`; 409 when the copy on disk moved."""
    hid = body.get("id")
    compare, create = "if_hash" in body, "if_absent" in body
    if compare and create:
        raise LibraryError("Choose either if_hash or if_absent, not both.")
    if not compare and not create:
        raise LibraryError("A fixed harness save needs if_hash (the copy you loaded) or if_absent: true (no copy yet).")
    if compare and (not isinstance(body["if_hash"], str) or not HASH.fullmatch(body["if_hash"])):
        raise LibraryError("Conditional saves require a fixed harness and its 12-character hash.")
    if create and body["if_absent"] is not True:
        raise LibraryError("Create-only saves require a fixed harness and if_absent: true.")
    prompt = body.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise LibraryError("Prompt must be non-empty text.")
    base = card(hid)
    clipped = clip_prompt(prompt, base["cap_bytes"])
    record = {**base, "prompt": clipped, "lane": "fixed", "hash": shallow_hash(hid, clipped, base["cap_bytes"])}
    with LOCK:
        try:
            current = _store().get_harness(OWNER, hid)
        except (StoreError, OSError):
            raise LibraryError("The harness library on this computer could not be read.", 503) from None
        current = _fixed_row(current) if current is not None else None
        if create and current is not None:
            raise LibraryError(CONFLICT, 409)
        if compare and (current is None or current["hash"] != body["if_hash"]):
            raise LibraryError(CONFLICT, 409)
        stored = _fixed_row(_write(record))
    return {"harness": stored, "stored": True, "conditional": True}


def save_minimal_record(body: dict) -> dict:
    built = compile_seven(blocks_for_record(body))
    if built["harness"]["id"] != body.get("id"):
        raise LibraryError("The minimal harness does not match its content ID. Save it through the wizard.")
    with LOCK:
        _write(built["harness"])
    return {"harness": built["harness"], "stored": True}


def save_harness(body: dict) -> dict:
    """POST /harnesses: a fixed id takes the conditional protocol, a `min_` id is recompiled."""
    hid = body.get("id")
    if isinstance(hid, str) and hid in AGENTS:
        return save_fixed(body)
    if "if_hash" in body or "if_absent" in body:
        raise LibraryError("Conditional saves require a fixed harness.")
    if isinstance(hid, str) and MINIMAL_ID.fullmatch(hid):
        return save_minimal_record(body)
    raise LibraryError("Name a harness.")


def save_wizard(body: dict) -> dict:
    built = compile_request(body)
    with LOCK:
        _write(built["harness"])
    return {**built, "stored": True}
