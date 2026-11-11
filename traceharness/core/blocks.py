"""Compose a harness from blocks, and the common-harness presets those blocks start from.

A block is one decision the loop makes: the prompt, the tool set, the permission
policy, how much history the model sees, when to stop, and the sampling knobs.
`compile_blocks` applies them in order onto a HarnessConfig. A later block of the
same type replaces the earlier one. Nothing here calls a model or writes a file.

The presets are measurement cells this lab can run. They are not the vendor
binaries. Each one copies the shape that product is known for inside this
codebase (tool surface, approval strictness, context window) and names the
model the lab has actually recorded for it, or a model already on the curated
OpenRouter list when no session in this checkout records one.
"""
from __future__ import annotations

import re
from dataclasses import asdict, fields as dc_fields

from .harness import DEFAULT_SYSTEM, HarnessConfig, content_hash
from .tools import ALL_TOOLS

TOOL_NAMES = tuple(ALL_TOOLS)
FILE_TOOLS = ["list_files", "read_file", "write_file", "edit_file", "run_tests", "submit"]
ALL_SURFACE = ["list_files", "read_file", "write_file", "edit_file", "run_tests", "bash", "submit"]

BLOCK_TYPES = ("prompt", "tools", "policy", "context", "stop", "sampling", "listing")
_ID = re.compile(r"^[a-z][a-z0-9_]{0,40}$")
_BUILT = re.compile(r"^built_[a-f0-9]{12}$")
_SECRET_KEYS = {"api_key", "key", "password", "token", "authorization", "secret"}


def _prompt(text: str) -> dict:
    return {"type": "prompt", "text": text}


def _tools(names: list) -> dict:
    return {"type": "tools", "names": list(names)}


def _policy(mode: str) -> dict:
    return {"type": "policy", "mode": mode}


def _context(window: int, observation_chars: int = 6000) -> dict:
    return {"type": "context", "window": window, "observation_chars": observation_chars}


def _stop(max_steps: int, max_total_tokens: int = 400_000) -> dict:
    return {"type": "stop", "max_steps": max_steps, "max_total_tokens": max_total_tokens}


def _sampling(temperature: float = 0.0, max_tokens_per_call: int = 2048) -> dict:
    return {"type": "sampling", "temperature": temperature, "max_tokens_per_call": max_tokens_per_call}


def _listing(include: bool = True) -> dict:
    return {"type": "listing", "include": include}


def _preset(pid, name, summary, default_model, default_basis, blocks, notes):
    return {
        "id": pid,
        "name": name,
        "summary": summary,
        "default_model": default_model,
        "default_basis": default_basis,
        "blocks": blocks,
        "notes": notes,
    }


# Models: only ids this checkout has recorded, or ids already on the curated
# list in backend/app.py (CURATED). A product's marketing default is not used
# when this repo has not run it.
_SONNET = "anthropic/claude-sonnet-5"          # captured_claude_code model claude-sonnet-5
_LUNA = "openai/gpt-5.6-luna"                  # curated OpenAI row
_GEMINI = "google/gemini-3.8-flash"            # curated Google row
_QWEN = "qwen/qwen3.8-27b"                     # curated Qwen row
_HAIKU = "anthropic/claude-haiku-4.5"          # curated Anthropic row

CATALOG = [
    _preset(
        "claude_code", "Claude Code",
        "Terminal agent. Full file and shell tools, strict permission check, full history.",
        _SONNET,
        "data/runs/captured_claude_code recorded model claude-sonnet-5. The OpenRouter id adds the anthropic/ prefix.",
        [_prompt(DEFAULT_SYSTEM), _tools(ALL_SURFACE), _policy("strict"),
         _context(0, 8000), _stop(40), _sampling(), _listing(True)],
        "Preset of this lab's runner. The captured session was claude-code@2.1.x, 28 steps.",
    ),
    _preset(
        "codex", "Codex",
        "OpenAI terminal agent. Full tools, approval required before a flagged command, full history.",
        _LUNA,
        "No Codex rollout in this checkout names a model this runner can call. openai/gpt-5.6-luna is the curated OpenAI model.",
        [_prompt(DEFAULT_SYSTEM), _tools(ALL_SURFACE), _policy("strict"),
         _context(0, 6000), _stop(30), _sampling(), _listing(True)],
        "Preset. The importer reads Codex approval decisions; this cell uses policy=strict.",
    ),
    _preset(
        "gemini_cli", "Gemini CLI",
        "Google terminal agent. Full tools. This checkout records no approval decision, so the preset blocks flagged commands.",
        _GEMINI,
        "google/gemini-3.8-flash is the curated Google model. This checkout has no Gemini CLI session that names a model.",
        [_prompt(DEFAULT_SYSTEM), _tools(ALL_SURFACE), _policy("strict"),
         _context(0, 6000), _stop(30), _sampling(), _listing(True)],
        "Preset. capture adapter policy for gemini_cli is none; strict is this cell's choice.",
    ),
    _preset(
        "qwen_code", "Qwen Code",
        "Qwen terminal chats. Full tools, strict permission check, full history.",
        _QWEN,
        "qwen/qwen3.8-27b is the curated Qwen model.",
        [_prompt(DEFAULT_SYSTEM), _tools(ALL_SURFACE), _policy("strict"),
         _context(0, 6000), _stop(30), _sampling(), _listing(True)],
        "Preset matching the qwen_code capture adapter's tool surface.",
    ),
    _preset(
        "cursor", "Cursor",
        "Editor agent. Full tools, strict permission check, full history.",
        _HAIKU,
        "No Cursor transcript in this checkout names a model. anthropic/claude-haiku-4.5 is the curated Anthropic model.",
        [_prompt(DEFAULT_SYSTEM), _tools(ALL_SURFACE), _policy("strict"),
         _context(0, 6000), _stop(30), _sampling(), _listing(True)],
        "Preset. Cursor transcripts import through the cursor adapter.",
    ),
    _preset(
        "openhands", "OpenHands",
        "Sandboxed autonomous agent. Full tools, strict permission check, longer step cap.",
        _LUNA,
        "No OpenHands log in this checkout names a callable model. openai/gpt-5.6-luna is the curated OpenAI model.",
        [_prompt(DEFAULT_SYSTEM), _tools(ALL_SURFACE), _policy("strict"),
         _context(0, 6000), _stop(50), _sampling(), _listing(True)],
        "Preset. OpenHands events import through the openhands adapter.",
    ),
    _preset(
        "swe_agent", "SWE-agent",
        "Issue solver that keeps only the last five tool observations.",
        _QWEN,
        "The bundled swe-agent runs used swe-agent-llama-70b, which this chat runner cannot call. qwen/qwen3.8-27b is the curated open-weights model.",
        [_prompt(DEFAULT_SYSTEM), _tools(ALL_SURFACE), _policy("strict"),
         _context(5, 6000), _stop(20), _sampling(), _listing(True)],
        "context_window 5 is the last-five-observations rule in harness.py.",
    ),
    _preset(
        "aider", "Aider",
        "Editor that changes files and runs tests. No free-form shell.",
        _LUNA,
        "openai/gpt-5.6-luna is the curated OpenAI model. This checkout has no Aider session.",
        [_prompt(DEFAULT_SYSTEM), _tools(FILE_TOOLS), _policy("strict"),
         _context(0, 6000), _stop(20), _sampling(), _listing(True)],
        "Preset. bash is omitted. The lab has no Aider importer.",
    ),
    _preset(
        "cline", "Cline",
        "Editor agent that asks before an edit or a command. Full tools, strict policy.",
        _SONNET,
        "No Cline session in this checkout. The model is the same claude-sonnet-5 id as the captured Claude Code session.",
        [_prompt(DEFAULT_SYSTEM), _tools(ALL_SURFACE), _policy("strict"),
         _context(0, 6000), _stop(30), _sampling(), _listing(True)],
        "Preset. The lab has no Cline importer.",
    ),
]

_BY_ID = {row["id"]: row for row in CATALOG}


def catalog_public() -> list[dict]:
    """Presets plus the hash of the cell they compile to. No secrets."""
    out = []
    for row in CATALOG:
        compiled = compile_blocks(row["blocks"], preset_id=row["id"])
        out.append({
            "id": row["id"],
            "name": row["name"],
            "summary": row["summary"],
            "default_model": row["default_model"],
            "default_basis": row["default_basis"],
            "notes": row["notes"],
            "blocks": row["blocks"],
            "harness_id": compiled["harness"]["id"],
            "hash": compiled["hash"],
        })
    return out


def palette() -> dict:
    return {
        "types": list(BLOCK_TYPES),
        "tools": list(TOOL_NAMES),
        "policies": ["strict", "permissive"],
        "blank": [
            _prompt(DEFAULT_SYSTEM),
            _tools(["list_files", "read_file", "edit_file", "run_tests", "submit"]),
            _policy("strict"),
            _context(0, 6000),
            _stop(12),
            _sampling(),
            _listing(True),
        ],
    }


def preset_blocks(preset_id: str) -> list[dict]:
    row = _BY_ID.get(preset_id)
    if row is None:
        raise KeyError(preset_id)
    return [dict(b) for b in row["blocks"]]


def _reject_secrets(block: dict) -> None:
    found = _SECRET_KEYS.intersection(block)
    if found:
        raise ValueError("a block cannot carry a key")


def compile_blocks(blocks: list, preset_id: str | None = None) -> dict:
    """Apply blocks in order. Returns {ok, errors, warnings, harness, hash}.

    `harness` is a plain dict the job runner can store. Its id is `built_` plus
    the 12-hex content hash, so two identical stacks are one cell.
    """
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(blocks, list) or not blocks:
        return {"ok": False, "errors": ["add at least one block"], "warnings": [], "harness": None, "hash": None}
    cfg = HarnessConfig()
    seen = set()
    for i, block in enumerate(blocks):
        if not isinstance(block, dict) or "type" not in block:
            errors.append(f"block {i} is missing type")
            continue
        try:
            _reject_secrets(block)
        except ValueError as e:
            errors.append(f"block {i}: {e}")
            continue
        kind = block.get("type")
        if kind not in BLOCK_TYPES:
            errors.append(f"block {i}: unknown type {kind!r}")
            continue
        seen.add(kind)
        try:
            _apply(cfg, kind, block)
        except ValueError as e:
            errors.append(f"block {i}: {e}")
    if "tools" not in seen:
        errors.append("add a tools block")
    elif "submit" not in (cfg.tools or []):
        warnings.append("no submit tool: the run can only stop by going quiet or hitting the step cap")
    if "stop" not in seen:
        warnings.append("no stop block: the default step cap is 20")
    if errors:
        return {"ok": False, "errors": errors, "warnings": warnings, "harness": None, "hash": None}
    digest = content_hash(cfg)
    cfg.id = "built_" + digest
    note_bits = ["built from blocks"]
    if preset_id:
        if preset_id not in _BY_ID:
            errors.append(f"unknown preset {preset_id!r}")
            return {"ok": False, "errors": errors, "warnings": warnings, "harness": None, "hash": None}
        note_bits.append(f"started from {preset_id}")
    cfg.notes = "; ".join(note_bits)
    # notes are excluded from the hash, so stamping them does not change the id.
    return {"ok": True, "errors": [], "warnings": warnings, "harness": asdict(cfg), "hash": digest}


def _apply(cfg: HarnessConfig, kind: str, block: dict) -> None:
    if kind == "prompt":
        text = block.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("prompt text is empty")
        if len(text) > 20_000:
            raise ValueError("prompt is longer than 20000 characters")
        cfg.system_prompt = text
    elif kind == "tools":
        names = block.get("names")
        if not isinstance(names, list) or not names:
            raise ValueError("name at least one tool")
        unknown = [n for n in names if n not in ALL_TOOLS]
        if unknown:
            raise ValueError("unknown tool " + ", ".join(unknown))
        if len(set(names)) != len(names):
            raise ValueError("tool list has a duplicate")
        cfg.tools = list(names)
    elif kind == "policy":
        mode = block.get("mode")
        if mode not in ("strict", "permissive"):
            raise ValueError("policy must be strict or permissive")
        cfg.policy = mode
    elif kind == "context":
        window = _int(block.get("window"), "window", 0, 100)
        chars = _int(block.get("observation_chars", 6000), "observation_chars", 200, 50_000)
        cfg.context_window = window
        cfg.observation_chars = chars
    elif kind == "stop":
        cfg.max_steps = _int(block.get("max_steps"), "max_steps", 1, 200)
        cfg.max_total_tokens = _int(block.get("max_total_tokens", 400_000), "max_total_tokens", 1_000, 2_000_000)
    elif kind == "sampling":
        temp = block.get("temperature", 0.0)
        if isinstance(temp, bool) or not isinstance(temp, (int, float)) or not 0 <= float(temp) <= 2:
            raise ValueError("temperature must be between 0 and 2")
        cfg.temperature = float(temp)
        cfg.max_tokens_per_call = _int(block.get("max_tokens_per_call", 2048), "max_tokens_per_call", 16, 32_000)
    elif kind == "listing":
        include = block.get("include")
        if not isinstance(include, bool):
            raise ValueError("listing include must be true or false")
        cfg.include_file_listing = include


def _int(value, name: str, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be an integer")
    if not lo <= value <= hi:
        raise ValueError(f"{name} must be between {lo} and {hi}")
    return value


def inline_config(hid: str, raw: dict) -> HarnessConfig:
    """The only inline harness a job may run: one this compiler just produced."""
    if not isinstance(raw, dict) or not _BUILT.fullmatch(hid or ""):
        raise ValueError("inline harness id must be built_ plus 12 hex")
    known = {f.name for f in dc_fields(HarnessConfig)}
    if _SECRET_KEYS.intersection(raw):
        raise ValueError("a harness cannot carry a key")
    data = {k: v for k, v in raw.items() if k in known}
    if data.get("id") != hid:
        raise ValueError("inline harness id does not match")
    tools = data.get("tools") or []
    if any(t not in ALL_TOOLS for t in tools):
        raise ValueError("unknown tool")
    cfg = HarnessConfig(**data)
    if content_hash(cfg) != hid[len("built_"):]:
        raise ValueError("inline harness does not match its id")
    return cfg


def safe_preset_id(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    if not _ID.fullmatch(value):
        raise ValueError("bad preset id")
    return value
