"""Version-bound native prompt editing, without patching a shared installation.

Private inventories are prepared from parsed, pinned JavaScript assets. Member
profiles can choose text/actions, never source anchors, paths, or executable code.
The classification rules follow agent-patcher 8d3c170/workbench.py; that program's
home-mutating workbench and apply/update commands are deliberately not imported.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re


AGENT_PATCHER_REVISION = "8d3c17099974c06f2cfb1547bb4744c05f845b56"
CLASSIFICATION_SOURCE = f"agent-patcher@{AGENT_PATCHER_REVISION}:workbench.py:CLAUDE_NFR_CATEGORIES"
CATEGORIES = (
    ("Security & Safety", ("sandbox", "deny", "security", "cyber", "hook", "computer-use", "safety", "refus", "perm")),
    ("Autonomous Agent", ("agent-", "auto-mode", "agentic", "subagent", "coordinator", "teammate", "swarm")),
    ("Tool Descriptions", ("tool-description-", "tool-", "bash", "grep", "glob", "edit", "write", "read")),
    ("System Reminders", ("system-reminder-", "reminder", "todowrite", "plan-mode", "ultraplan")),
    ("Response Quality", ("response", "format", "output", "tone", "concise", "style", "markdown", "emoji")),
    ("Task Planning", ("task", "plan", "execution", "todo", "doing-tasks", "workflow")),
    ("Git & VCS", ("git", "commit", "pr-", "branch", "worktree", "gh")),
    ("File & Code Ops", ("file", "code", "patch", "notebook", "diff", "lint")),
    ("Context & Memory", ("context", "memory", "compact", "claude-md", "session", " scratch")),
    ("Environment & Platform", ("environment", "platform", "mcp", "shell", "os", "wsl", "powershell")),
    ("API & Integration", ("api", "integration", "web", "fetch", "search", "oauth", "ide")),
    ("Testing & Validation", ("test", "verify", "check", "debug")),
)
PINS = ("runtime_id", "runtime_version", "image_digest", "binary_sha256", "inventory_sha256",
        "taxonomy_sha256", "materializer_sha256")
PROFILE_FIELDS = {"schema_version", *PINS, "default_action", "overrides"}
INVENTORY_FIELDS = {"schema_version", *PINS, "blocks"}
BLOCK_FIELDS = {"id", "title", "class_name", "class_source", "source_layer", "capability",
                "baseline_sha256", "baseline_utf8", "occurrence_count", "required_placeholders"}
HASH = re.compile(r"[0-9a-f]{64}\Z")
BLOCK_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}\Z")
PLACEHOLDER = re.compile(r"\$\{TH_PROMPT_EXPR_[0-9]+\}")
MAX_BLOCKS = 20_000
MAX_OVERRIDES = 4096
MAX_REPLACEMENT_BYTES = 250_000
MAX_PROFILE_BYTES = 768 * 1024


class NativePromptError(ValueError):
    """The profile or prepared inventory cannot be applied exactly."""


def canonical_bytes(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                          allow_nan=False).encode("utf-8")
    except (ValueError, TypeError, UnicodeError) as exc:
        raise NativePromptError("Native prompt metadata is not valid UTF-8 JSON") from exc


def digest(value):
    return hashlib.sha256(value).hexdigest()


def materializer_sha256():
    paths = (Path(__file__), Path(__file__).with_name("native_prompts_elf.py"))
    return digest(canonical_bytes({path.name: digest(path.read_bytes()) for path in paths}))


def taxonomy_sha256():
    return digest(canonical_bytes({"source": CLASSIFICATION_SOURCE, "categories": CATEGORIES,
                                   "fallback": "General Behavior"}))


def classify(block_id, title=""):
    haystack = (block_id + " " + title).lower()
    return next((name for name, words in CATEGORIES if any(word in haystack for word in words)), "General Behavior")


def _require(condition, message):
    if not condition:
        raise NativePromptError(message)


def _text(value, name):
    _require(isinstance(value, str), f"{name} must be text")
    try:
        encoded = value.encode("utf-8")
    except UnicodeError as exc:
        raise NativePromptError(f"{name} is not valid UTF-8") from exc
    _require("\x00" not in value, f"{name} contains a NUL")
    return encoded


def inventory_sha256(inventory):
    return digest(canonical_bytes({key: value for key, value in inventory.items() if key != "inventory_sha256"}))


def validate_inventory(inventory, *, require_private=False):
    """Public views retain a trusted private-inventory digest; only private views can recompute it."""
    _require(isinstance(inventory, dict), "Native prompt inventory must be an object")
    _require(set(inventory) in (INVENTORY_FIELDS, INVENTORY_FIELDS | {"_private"}),
             "Invalid native prompt inventory fields")
    _require(type(inventory.get("schema_version")) is int and inventory["schema_version"] == 1,
             "Unsupported native prompt inventory schema")
    for name in PINS:
        value = inventory.get(name)
        _text(value, name)
        if name == "image_digest":
            _require(value.startswith("sha256:") and HASH.fullmatch(value[7:]), "Invalid inventory image digest")
        elif name.endswith("sha256"):
            _require(HASH.fullmatch(value), f"Invalid inventory {name}")
        else:
            _require(bool(value) and len(value) <= 256, f"Invalid inventory {name}")
    blocks = inventory.get("blocks")
    _require(isinstance(blocks, list) and len(blocks) <= MAX_BLOCKS, "Invalid native prompt block list")
    ids = set()
    for block in blocks:
        _require(isinstance(block, dict) and set(block) == BLOCK_FIELDS, "Invalid native prompt block fields")
        block_id = block.get("id")
        _require(isinstance(block_id, str) and BLOCK_ID.fullmatch(block_id) and block_id not in ids,
                 "Invalid or duplicate native prompt block id")
        ids.add(block_id)
        for name, maximum in (("title", 500), ("class_name", 200), ("class_source", 500), ("source_layer", 100)):
            _text(block.get(name), name)
            _require(len(block[name]) <= maximum, f"Native prompt {name} exceeds its limit")
        _require(isinstance(block.get("capability"), str)
                 and block["capability"] in {"patchable", "observed-only", "unavailable"}, "Invalid block capability")
        body = _text(block.get("baseline_utf8"), "baseline_utf8")
        _require(len(body) <= MAX_REPLACEMENT_BYTES, "Native prompt baseline exceeds its byte limit")
        _require(block.get("baseline_sha256") == digest(body), "Native prompt baseline hash mismatch")
        count = block.get("occurrence_count")
        _require(type(count) is int and 0 <= count <= 100_000, "Invalid native prompt occurrence count")
        placeholders = block.get("required_placeholders")
        _require(isinstance(placeholders, list) and len(placeholders) <= 1000
                 and all(isinstance(p, str) and len(p) <= 1000 and PLACEHOLDER.fullmatch(p)
                                                      for p in placeholders), "Invalid native prompt placeholders")
        _require(PLACEHOLDER.findall(block["baseline_utf8"]) == placeholders, "Baseline placeholder sequence mismatch")
        if block["capability"] == "patchable":
            _require(count > 0, "A patchable block must have verified source occurrences")
    private = inventory.get("_private")
    _require(not require_private or isinstance(private, dict), "Private source anchors are required")
    if private is not None:
        _require(isinstance(private, dict) and private.get("source_kind") == "javascript", "Unsupported native source kind")
        _require(isinstance(private.get("source_sha256"), str) and HASH.fullmatch(private["source_sha256"]),
                 "Invalid native source digest")
        _require(type(private.get("source_bytes")) is int and private["source_bytes"] > 0, "Invalid native source size")
        anchors = private.get("anchors")
        patchable = {b["id"] for b in blocks if b["capability"] == "patchable"}
        _require(isinstance(anchors, dict) and set(anchors) == patchable, "Native anchor membership mismatch")
        occupied = []
        for block in blocks:
            if block["id"] not in patchable:
                continue
            occurrences = anchors[block["id"]]
            _require(isinstance(occurrences, list) and len(occurrences) == block["occurrence_count"], "Native occurrence count mismatch")
            for occurrence in occurrences:
                _require(isinstance(occurrence, dict), "Invalid native source anchor")
                start, end = occurrence.get("start"), occurrence.get("end")
                _require(type(start) is int and type(end) is int and 0 <= start < end <= private["source_bytes"],
                         "Invalid native source anchor bounds")
                _require(isinstance(occurrence.get("source_sha256"), str) and HASH.fullmatch(occurrence["source_sha256"]),
                         "Invalid native source anchor hash")
                kind = occurrence.get("kind")
                expressions, segments = occurrence.get("expressions"), occurrence.get("segments")
                _require(isinstance(kind, str) and kind in {"string", "template"} and isinstance(expressions, list)
                         and isinstance(segments, list) and len(segments) == len(expressions) + 1,
                         "Invalid native literal structure")
                _require(kind != "string" or not expressions, "String literal has unexpected expressions")
                for item in expressions + segments:
                    _text(item, "native literal component")
                expected = [f"${{TH_PROMPT_EXPR_{i}}}" for i in range(len(expressions))]
                _require(block["required_placeholders"] == expected, "Native template arity mismatch")
                body = "".join(segment + (expected[i] if i < len(expected) else "") for i, segment in enumerate(segments))
                _require(body == block["baseline_utf8"], "Native literal content differs from inventory baseline")
                occupied.append((start, end))
        occupied.sort()
        _require(all(left[1] <= right[0] for left, right in zip(occupied, occupied[1:])),
                 "Native source anchors overlap or repeat")
        _require(inventory_sha256(inventory) == inventory["inventory_sha256"], "Native private inventory hash mismatch")
    return inventory


def public_inventory(inventory):
    validate_inventory(inventory, require_private=True)
    return {key: value for key, value in inventory.items() if key != "_private"}


def canonical_profile(profile, inventory):
    validate_inventory(inventory)
    _require(isinstance(profile, dict) and set(profile) == PROFILE_FIELDS, "Invalid native prompt profile fields")
    _require(type(profile.get("schema_version")) is int and profile["schema_version"] == 1,
             "Unsupported native prompt profile schema")
    for name in PINS:
        _require(profile[name] == inventory[name], f"Native prompt {name} does not match the selected inventory")
    _require(isinstance(profile["default_action"], str) and profile["default_action"] in {"keep", "disable"},
             "Invalid default native prompt action")
    overrides = profile["overrides"]
    _require(isinstance(overrides, list) and len(overrides) <= MAX_OVERRIDES, "Too many native prompt overrides")
    by_id = {block["id"]: block for block in inventory["blocks"]}
    normalized = {}
    for override in overrides:
        _require(isinstance(override, dict), "Invalid native prompt override")
        action = override.get("action")
        fields = {"block_id", "baseline_sha256", "action"}
        if action == "replace":
            fields |= {"replacement_utf8", "replacement_sha256"}
        _require(set(override) == fields and isinstance(action, str) and action in {"keep", "disable", "replace"},
                 "Invalid native prompt override fields")
        block_id = override.get("block_id")
        _require(isinstance(block_id, str) and block_id in by_id and block_id not in normalized,
                 "Unknown or duplicate native prompt override")
        block = by_id[block_id]
        _require(override["baseline_sha256"] == block["baseline_sha256"], "Native prompt override baseline changed")
        _require(action == "keep" or block["capability"] == "patchable", "Native prompt block is not patchable")
        if action == "replace":
            body = _text(override["replacement_utf8"], "replacement_utf8")
            _require(0 < len(body) <= MAX_REPLACEMENT_BYTES, "Native replacement must be nonempty and within the byte limit")
            _require(digest(body) == override["replacement_sha256"], "Native replacement digest mismatch")
            _require(PLACEHOLDER.findall(override["replacement_utf8"]) == block["required_placeholders"],
                     "Native replacement must preserve the exact template placeholder order and multiplicity")
            _require("${TH_PROMPT_EXPR" not in PLACEHOLDER.sub("", override["replacement_utf8"]),
                     "Native replacement contains an invalid template placeholder")
        normalized[block_id] = dict(override)
    result = {key: profile[key] for key in PROFILE_FIELDS if key != "overrides"}
    result["overrides"] = [normalized[b["id"]] for b in inventory["blocks"] if b["id"] in normalized]
    _require(len(canonical_bytes(result)) <= MAX_PROFILE_BYTES, "Native prompt profile exceeds the byte limit")
    return result


def profile_sha256(profile):
    return digest(canonical_bytes(profile))


def resolve_block_actions(profile, inventory):
    profile = canonical_profile(profile, inventory)
    overrides = {o["block_id"]: o for o in profile["overrides"]}
    return {block["id"]: (overrides[block["id"]]["action"] if block["id"] in overrides else
            profile["default_action"] if block["capability"] == "patchable" else "keep") for block in inventory["blocks"]}


def _render_replacement(text, occurrence, original):
    if occurrence["kind"] == "string":
        return json.dumps(text, ensure_ascii=True).encode("ascii")
    pieces = PLACEHOLDER.split(text)
    expressions = occurrence["expressions"]
    _require(len(pieces) == len(expressions) + 1, "Native template replacement arity changed")
    rendered = []
    for i, piece in enumerate(pieces):
        escaped = json.dumps(piece, ensure_ascii=True)[1:-1].replace("`", "\\`").replace("${", "\\${")
        rendered.append(escaped)
        if i < len(expressions):
            rendered.append("${" + expressions[i] + "}")
    return ("`" + "".join(rendered) + "`").encode("utf-8")


def materialize_source(pristine, inventory, profile):
    """Return a new JS asset and metadata-only proof. Always start from pinned pristine bytes."""
    validate_inventory(inventory, require_private=True)
    profile = canonical_profile(profile, inventory)
    _require(isinstance(pristine, bytes), "Native source must be bytes")
    private = inventory["_private"]
    _require(len(pristine) == private["source_bytes"] and digest(pristine) == private["source_sha256"],
             "Native source does not match the pinned inventory")
    _require(inventory["materializer_sha256"] == materializer_sha256(), "Native materializer identity changed")
    _require(inventory["taxonomy_sha256"] == taxonomy_sha256(), "Native taxonomy identity changed")
    actions = resolve_block_actions(profile, inventory)
    overrides = {o["block_id"]: o for o in profile["overrides"]}
    patches = []
    verified = 0
    for block in inventory["blocks"]:
        for occurrence in private["anchors"].get(block["id"], []):
            start, end = occurrence["start"], occurrence["end"]
            original = pristine[start:end]
            _require(digest(original) == occurrence["source_sha256"], "Native source anchor read-back mismatch")
            verified += 1
            action = actions[block["id"]]
            if action == "keep":
                continue
            if action == "disable":
                # Evaluating the original template preserves expression evaluation,
                # ordering and coercion side effects while withholding its output.
                replacement = b'""' if occurrence["kind"] == "string" else b"(" + original + b', "")'
            else:
                replacement = _render_replacement(overrides[block["id"]]["replacement_utf8"], occurrence, original)
            patches.append((start, end, replacement, block["id"], action))
    patches.sort(key=lambda p: p[0])
    chunks, cursor, length, reads = [], 0, 0, defaultdict(list)
    for start, end, replacement, block_id, action in patches:
        unchanged = pristine[cursor:start]
        chunks.extend((unchanged, replacement))
        result_start = length + len(unchanged)
        reads[block_id].append({"before_start": start, "before_end": end,
                               "before_sha256": digest(pristine[start:end]),
                               "after_start": result_start, "after_end": result_start + len(replacement),
                               "after_sha256": digest(replacement)})
        length = result_start + len(replacement)
        cursor = end
    chunks.append(pristine[cursor:])
    result = b"".join(chunks)
    for entries in reads.values():
        for entry in entries:
            _require(digest(result[entry["after_start"]:entry["after_end"]]) == entry["after_sha256"],
                     "Materialized native target read-back failed")
    counts = Counter(actions[b["id"]] for b in inventory["blocks"] if b["capability"] == "patchable")
    evidence = {
        "schema_version": 1, "mechanism": "javascript-literal-v1", **{name: inventory[name] for name in PINS},
        "profile_sha256": profile_sha256(profile), "default_action": profile["default_action"],
        "baseline_source_sha256": digest(pristine), "materialized_source_sha256": digest(result),
        "baseline_source_bytes": len(pristine), "materialized_source_bytes": len(result),
        "verified_source_occurrences": verified, "changed_source_occurrences": len(patches),
        "counts": {name: counts[name] for name in ("keep", "replace", "disable")},
        "changed_blocks": [{"block_id": block["id"], "action": actions[block["id"]],
                            "occurrence_count": len(reads[block["id"]]),
                            "occurrence_readback_sha256": digest(canonical_bytes(reads[block["id"]]))}
                           for block in inventory["blocks"] if block["id"] in reads],
        "only_inventory_targets_changed": True, "readback_verified": True,
        "runtime_consumption": "UNVERIFIED", "outbound_observation": "UNVERIFIED",
    }
    return result, evidence
